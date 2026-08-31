import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.SA_PORT || 17321)
const page = readFileSync(join(import.meta.dirname, 'loading-page.html'), 'utf8')

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[loading] serving on http://localhost:${PORT}`)
  writeFileSync(join(import.meta.dirname, '.loading-pid'), String(process.pid))
})
