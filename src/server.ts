import fastify from "fastify";
import { z } from "zod"
import { sql } from "./lib/postgres";
import postgres from "postgres";
import { redis } from "./lib/redis";

const app = fastify()

app.listen({
  port: 3333,
}).then(() => {
  console.log("<-- Server Running -->")
})

app.get("/api/links", async (request, response) => {
  const results = await sql`
    SELECT * 
    FROM short_links
    ORDER BY created_at DESC
  ` 

  return results
})

app.post("/api/links", async (request, reply) => {
  const createLinkSchema = z.object({
    code: z.string().min(3),
    url: z.string().url()
  })

  
  const { code, url } = createLinkSchema.parse(request.body)
  
  try {
    const result = await sql`
      INSERT INTO short_links (code, original_url)
      VALUES (${code}, ${url})
      RETURNING id
    `
    const link = result[0]

    return reply.status(201).send({ shortLinkId: link.id })

  } catch (err) {
    if(err instanceof postgres.PostgresError) {
      if(err.code === "23585") {
        return reply.status(400).send({message: "Duplicated error"})
      }
    }

    console.log(err)

      return reply.status(500).send({ message: "internal error" })
  }
})

app.get('/:code', async (request, reply) => {
  const getLinkSchema = z.object({
    code: z.string().min(3),
  })

  const { code } = getLinkSchema.parse(request.params)

  const result = await sql`
    SELECT id, original_url
    FROM short_links
    WHERE short_links.code = ${code}
  `

  if (result.length === 0) {
    return reply.status(400).send({ message: 'Link not found.' })
  }

  const link = result[0]

  await redis.zIncrBy('metrics', 1, link.id)

  return reply.redirect(301, link.original_url)
})

app.get("/api/metrics", async () => {
  const result = redis.zRangeByScoreWithScores("metrics", 0, 50)

  const metrics = 
  (await result).sort((a,b) => b.score - a.score)
  .map(item => {
    return {
      shortLinkId: Number(item.value),
      clicks: item.score
    }
  })

  return result
})