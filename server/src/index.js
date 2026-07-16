import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { registerRequestRoutes } from './routes/requests.js'

const app = express()
const httpServer = createServer(app)
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
const io = new Server(httpServer, { cors: { origin: clientOrigin } })

app.use(cors({ origin: clientOrigin }))
app.use(express.json({ limit: '1mb' }))
app.get('/api/v1/health', (_request, response) => response.json({ status: 'ok', service: 'helpnow-api' }))
registerRequestRoutes(app, io)
io.on('connection', (socket) => socket.emit('server:ready', { message: 'Connected to HelpNow real-time updates.' }))

const port = Number(process.env.PORT ?? 3000)
httpServer.listen(port, () => console.log(`HelpNow API listening on http://localhost:${port}`))
