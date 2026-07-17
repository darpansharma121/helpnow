import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import mongoose from 'mongoose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerRequestRoutes } from './routes/requests.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const httpServer = createServer(app)

// Support dynamic deployments by allowing flexible origin socket setups
const clientOrigin = process.env.CLIENT_ORIGIN ?? '*'
const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ['GET', 'POST', 'PATCH']
  }
})

// Establish connection to MongoDB
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/helpnow'
let isMongoConnected = false

console.log('Connecting to MongoDB at:', mongoUri)
mongoose.connect(mongoUri)
  .then(() => {
    isMongoConnected = true
    console.log('MongoDB connected successfully.')
  })
  .catch((err) => {
    console.error('MongoDB connection failed. Falling back to in-memory store. Error:', err.message)
  })

const dbContext = {
  isConnected: () => isMongoConnected
}

app.use(cors({ origin: clientOrigin }))
app.use(express.json({ limit: '1mb' }))

// Register API Routes
registerRequestRoutes(app, io, dbContext)

app.get('/api/v1/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'helpnow-api',
    database: isMongoConnected ? 'mongodb' : 'in-memory-fallback'
  })
})

io.on('connection', (socket) => socket.emit('server:ready', {
  message: 'Connected to HelpNow real-time updates.',
  database: isMongoConnected ? 'mongodb' : 'in-memory-fallback'
}))

// Serve compiled static assets in production deployment setups
const distPath = path.join(__dirname, '../../client/dist')
app.use(express.static(distPath))

// Wildcard SPA route fallback using Express 5 compatible middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return next()
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('HelpNow API Server is running. Compile client assets (npm run build) to view the client UI.')
    }
  })
})

const port = Number(process.env.PORT ?? 3000)
httpServer.listen(port, () => console.log(`HelpNow API listening on http://localhost:${port}`))
