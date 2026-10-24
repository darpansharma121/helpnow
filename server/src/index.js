import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerRequestRoutes } from './routes/requests.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in server/.env.')
}

const app = express()
const httpServer = createServer(app)

// Production serves the client and API from one origin; local dev may set CLIENT_ORIGIN.
const clientOrigin = process.env.CLIENT_ORIGIN
const io = new Server(httpServer, {
  ...(clientOrigin ? {
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST', 'PATCH']
    }
  } : {})
})

if (clientOrigin) app.use(cors({ origin: clientOrigin }))
app.use(express.json({ limit: '1mb' }))

// Register API Routes
registerRequestRoutes(app, io)

app.get('/api/v1/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'helpnow-api',
    database: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? 'supabase' : 'not-configured'
  })
})

app.use('/api', (request, response) => {
  response.status(404).json({
    error: `API route not found: ${request.method} ${request.path}`
  })
})

app.use((error, request, response, next) => {
  if (!request.path.startsWith('/api/')) return next(error)

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500
  response.status(status).json({
    error: status === 400 ? 'Invalid request body.' : 'The API could not complete the request.'
  })
})

io.on('connection', (socket) => socket.emit('server:ready', {
  message: 'Connected to HelpNow real-time updates.',
  database: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? 'supabase' : 'not-configured'
}))

// Serve compiled static assets in production deployment setups
const distPath = path.join(__dirname, '../../client/dist')
app.use(express.static(distPath))

// Wildcard SPA route fallback using Express 5 compatible middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return next()
  }
  if (req.method !== 'GET' || !req.get('accept')?.includes('text/html')) return next()

  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      console.error('Unable to serve the HelpNow client build:', err.message)
      res.status(503).type('text/plain').send('HelpNow frontend build is unavailable. Build client/dist before starting the production server.')
    }
  })
})

const port = Number(process.env.PORT ?? 3002)
httpServer.listen(port, () => console.log(`HelpNow API listening on http://localhost:${port}`))
