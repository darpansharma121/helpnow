import { randomUUID } from 'node:crypto'
import { HelpRequest } from '../models/HelpRequest.js'

// In-memory array fallback (empty — no dummy data, only real user-created requests)
const inMemoryRequests = []

const allowedUrgencies = new Set(['normal', 'urgent', 'critical'])
const allowedCategories = new Set(['medical', 'transport', 'essentials', 'other'])
const allowedStatuses = new Set(['open', 'accepted', 'in_progress', 'resolved', 'cancelled'])

// Validation
function validateRequest(body) {
  const errors = []
  if (body.title !== undefined && body.title !== null && body.title.trim() !== '') {
    if (typeof body.title !== 'string') {
      errors.push('title must be a string')
    }
  }
  if (typeof body.description !== 'string' || body.description.trim().length < 10) {
    errors.push('description must be at least 10 characters')
  }
  if (typeof body.category !== 'string' || !allowedCategories.has(body.category.trim().toLowerCase())) {
    errors.push('category must be medical, transport, essentials, or other')
  }
  if (!allowedUrgencies.has(body.urgency)) {
    errors.push('urgency must be normal, urgent, or critical')
  }
  if (!body.location || typeof body.location.lat !== 'number' || typeof body.location.lng !== 'number') {
    errors.push('location must contain numeric lat and lng coordinates')
  }
  if (typeof body.requesterName !== 'string' || !body.requesterName.trim()) {
    errors.push('requesterName is required')
  }
  if (typeof body.requesterPhone !== 'string' || !body.requesterPhone.trim()) {
    errors.push('requesterPhone is required')
  }
  return errors
}

// Helper: get start of today in IST (UTC+5:30)
function getStartOfTodayIST() {
  const now = new Date()
  // Convert to IST by adding 5h30m offset
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  // Get midnight IST in UTC
  const istMidnight = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()))
  // Convert back to UTC
  return new Date(istMidnight.getTime() - istOffset)
}

// ----------------------------------------------------
// AI AGENT PIPELINE: Spam Detector + Classifier + Summarizer
// ----------------------------------------------------
async function runAIAgents(title, description) {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    try {
      console.log('Triggering Gemini AI Agent chain...')
      const prompt = `Analyze this community neighborhood help request.
Title: "${title}"
Description: "${description}"

Evaluate and return a structured JSON response matching these criteria:
1. "isSpam" (Boolean): true if it is advertisement, offensive, spam, clickbait, or unrelated.
2. "category" (String): one of "medical", "transport", "essentials", or "other".
3. "urgency" (String): one of "normal", "urgent", or "critical".
4. "aiSummary" (String): A clear, single-sentence helper-facing summary of the request details (under 80 characters).`

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                isSpam: { type: 'BOOLEAN' },
                category: { type: 'STRING', enum: ['medical', 'transport', 'essentials', 'other'] },
                urgency: { type: 'STRING', enum: ['normal', 'urgent', 'critical'] },
                aiSummary: { type: 'STRING' }
              },
              required: ['isSpam', 'category', 'urgency', 'aiSummary']
            }
          }
        })
      })

      if (res.ok) {
        const json = await res.json()
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          const parsed = JSON.parse(text)
          console.log('Gemini AI Agent output:', parsed)
          return parsed
        }
      } else {
        console.warn('Gemini API returned error code:', res.status)
      }
    } catch (err) {
      console.error('Failed to run Gemini AI agents, running fallback:', err.message)
    }
  }

  // Fallback Rule-Based Simulation (Keyword matching & summarization)
  console.log('Executing local simulated AI Agents...')
  const text = `${title} ${description}`.toLowerCase()
  
  let category = 'other'
  if (/\b(blood|donor|hospital|clinic|doctor|medicine|medical|insulin|pharmacy|ambulance|accident|injury|sick|wound)\b/.test(text)) {
    category = 'medical'
  } else if (/\b(bike|car|scooter|puncture|wheel|tyre|tire|mechanic|tow|breakdown|flat|engine|battery|fuel|petrol)\b/.test(text)) {
    category = 'transport'
  } else if (/\b(grocery|groceries|food|water|bottle|senior|elderly|delivery|essentials|milk|diaper)\b/.test(text)) {
    category = 'essentials'
  }

  let urgency = 'normal'
  if (/\b(critical|dying|emergency|immediate|bleeding|severe|danger|accident|cardiac|heart|now)\b/.test(text)) {
    urgency = 'critical'
  } else if (/\b(urgent|soon|mechanic|broken|puncture|stranded|asap|today|quickly)\b/.test(text)) {
    urgency = 'urgent'
  }

  const isSpam = /\b(viagra|casino|earn money|crypto investment|click link|subscribe|advertisement)\b/.test(text)
  const cleanTitle = title.trim()
  const summary = cleanTitle.length > 50 ? cleanTitle.substring(0, 50) + '...' : cleanTitle
  const aiSummary = `[Local AI] Need: ${summary}`

  return { isSpam, category, urgency, aiSummary }
}

// ----------------------------------------------------
// CLEANUP SCHEDULER: Delete requests older than 5 days
// Runs every hour after server starts
// ----------------------------------------------------
export function startCleanupScheduler(dbContext) {
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
  const ONE_HOUR_MS = 60 * 60 * 1000

  async function cleanup() {
    const cutoff = new Date(Date.now() - FIVE_DAYS_MS)

    if (dbContext.isConnected()) {
      try {
        const result = await HelpRequest.deleteMany({ createdAt: { $lt: cutoff } })
        if (result.deletedCount > 0) {
          console.log(`[Cleanup] Deleted ${result.deletedCount} request(s) older than 5 days.`)
        }
      } catch (err) {
        console.error('[Cleanup] Failed to delete old requests:', err.message)
      }
    } else {
      // In-memory fallback cleanup
      const before = inMemoryRequests.length
      const cutoffTime = cutoff.getTime()
      for (let i = inMemoryRequests.length - 1; i >= 0; i--) {
        if (new Date(inMemoryRequests[i].createdAt).getTime() < cutoffTime) {
          inMemoryRequests.splice(i, 1)
        }
      }
      const removed = before - inMemoryRequests.length
      if (removed > 0) {
        console.log(`[Cleanup] Removed ${removed} in-memory request(s) older than 5 days.`)
      }
    }
  }

  // Run immediately on startup, then every hour
  cleanup()
  setInterval(cleanup, ONE_HOUR_MS)
  console.log('[Cleanup] Scheduler started — will purge requests older than 5 days every hour.')
}

export function registerRequestRoutes(app, io, dbContext) {
  // Format MongoDB model structure to client ID interface
  function formatReq(doc) {
    if (!doc) return null
    const obj = doc.toObject ? doc.toObject() : doc
    return {
      id: obj._id ? obj._id.toString() : obj.id,
      ...obj,
      _id: undefined,
      __v: undefined
    }
  }

  // 1. GET ALL REQUESTS (today only)
  app.get('/api/v1/requests', async (_request, response) => {
    try {
      const todayStart = getStartOfTodayIST()

      if (dbContext.isConnected()) {
        // Query database — only today's requests
        const dbDocs = await HelpRequest.find({ createdAt: { $gte: todayStart } }).sort({ createdAt: -1 })
        const formatted = dbDocs.map(formatReq)
        
        // Sorting: Active (critical -> urgent -> normal) first, resolved/cancelled last
        const sorted = formatted.sort((a, b) => {
          const aActive = a.status !== 'resolved' && a.status !== 'cancelled' && a.status !== 'flagged'
          const bActive = b.status !== 'resolved' && b.status !== 'cancelled' && b.status !== 'flagged'
          if (aActive && !bActive) return -1
          if (!aActive && bActive) return 1
          if (aActive && bActive) {
            const urgencyWeight = { critical: 3, urgent: 2, normal: 1 }
            const diff = (urgencyWeight[b.urgency] || 0) - (urgencyWeight[a.urgency] || 0)
            if (diff !== 0) return diff
          }
          return new Date(b.createdAt) - new Date(a.createdAt)
        })
        return response.json({ data: sorted })
      } else {
        // In-memory fallback — filter to today only
        const todayMs = todayStart.getTime()
        const todayRequests = inMemoryRequests.filter(r => new Date(r.createdAt).getTime() >= todayMs)
        const sorted = todayRequests.sort((a, b) => {
          const aActive = a.status !== 'resolved' && a.status !== 'cancelled' && a.status !== 'flagged'
          const bActive = b.status !== 'resolved' && b.status !== 'cancelled' && b.status !== 'flagged'
          if (aActive && !bActive) return -1
          if (!aActive && bActive) return 1
          if (aActive && bActive) {
            const urgencyWeight = { critical: 3, urgent: 2, normal: 1 }
            const diff = (urgencyWeight[b.urgency] || 0) - (urgencyWeight[a.urgency] || 0)
            if (diff !== 0) return diff
          }
          return new Date(b.createdAt) - new Date(a.createdAt)
        })
        return response.json({ data: sorted })
      }
    } catch (err) {
      console.error(err)
      return response.status(500).json({ error: 'Database query failed' })
    }
  })

  // 2. CREATE HELP REQUEST
  app.post('/api/v1/requests', async (request, response) => {
    const errors = validateRequest(request.body)
    if (errors.length) {
      return response.status(400).json({ error: 'Invalid request', details: errors })
    }

    try {
      const { title, description, category, urgency, location, requesterName, requesterPhone, requesterId } = request.body

      // Run AI agents pipeline
      const aiResult = await runAIAgents(title || description, description)
      
      // If AI spam agent flags it, set status to flagged immediately
      const initialStatus = aiResult.isSpam ? 'flagged' : 'open'
      const aiSummary = aiResult.aiSummary

      // Fallback for title if empty
      const finalTitle = title && title.trim() ? title.trim() : (description.length > 40 ? description.substring(0, 40).trim() + '...' : description.trim())

      const reqData = {
        requesterId: requesterId || `user-${randomUUID().substring(0, 8)}`,
        requesterName: requesterName.trim(),
        requesterPhone: requesterPhone.trim(),
        title: finalTitle,
        description: description.trim(),
        category: aiResult.category || category.toLowerCase(),
        urgency: aiResult.urgency || urgency,
        location,
        status: initialStatus,
        reports: 0,
        aiSummary,
        createdAt: new Date().toISOString(),
        acceptedAt: null,
        resolvedAt: null,
        helperId: null,
        helperName: null,
        helperPhone: null
      }

      let createdRequest = null

      if (dbContext.isConnected()) {
        const doc = await new HelpRequest(reqData).save()
        createdRequest = formatReq(doc)
      } else {
        createdRequest = { id: randomUUID(), ...reqData }
        inMemoryRequests.unshift(createdRequest)
      }

      // Broadcast Socket message
      if (createdRequest.status !== 'flagged') {
        io.emit('request:created', createdRequest)
      }
      
      return response.status(201).json({ data: createdRequest })
    } catch (err) {
      console.error(err)
      return response.status(500).json({ error: 'Failed to create help request' })
    }
  })

  // 3. UPDATE STATUS (LIFECYCLE FLOW)
  app.patch('/api/v1/requests/:id/status', async (request, response) => {
    const { id } = request.params
    const { status, helperId, helperName, helperPhone } = request.body

    if (!allowedStatuses.has(status)) {
      return response.status(400).json({ error: 'Invalid status' })
    }

    try {
      let updatedRequest = null

      if (dbContext.isConnected()) {
        const updateData = { status }
        if (status === 'accepted') {
          updateData.helperId = helperId || 'demo-helper-id'
          updateData.helperName = helperName || 'Neha Das'
          updateData.helperPhone = helperPhone || '+91 87654 32109'
          updateData.acceptedAt = new Date()
        } else if (status === 'open') {
          updateData.helperId = null
          updateData.helperName = null
          updateData.helperPhone = null
          updateData.acceptedAt = null
        } else if (status === 'resolved') {
          updateData.resolvedAt = new Date()
        }

        const doc = await HelpRequest.findByIdAndUpdate(id, updateData, { new: true })
        if (!doc) {
          return response.status(404).json({ error: 'Request not found' })
        }
        updatedRequest = formatReq(doc)
      } else {
        // In-memory fallback
        const reqIndex = inMemoryRequests.findIndex(r => r.id === id)
        if (reqIndex === -1) {
          return response.status(404).json({ error: 'Request not found' })
        }
        
        const req = inMemoryRequests[reqIndex]
        req.status = status
        if (status === 'accepted') {
          req.helperId = helperId || 'demo-helper-id'
          req.helperName = helperName || 'Neha Das'
          req.helperPhone = helperPhone || '+91 87654 32109'
          req.acceptedAt = new Date().toISOString()
        } else if (status === 'open') {
          req.helperId = null
          req.helperName = null
          req.helperPhone = null
          req.acceptedAt = null
        } else if (status === 'resolved') {
          req.resolvedAt = new Date().toISOString()
        }
        req.updatedAt = new Date().toISOString()
        inMemoryRequests[reqIndex] = req
        updatedRequest = req
      }

      io.emit('request:updated', updatedRequest)
      return response.json({ data: updatedRequest })
    } catch (err) {
      console.error(err)
      return response.status(500).json({ error: 'Status update failed' })
    }
  })

  // 4. REPORT A REQUEST (SPAM CONTROL)
  app.post('/api/v1/requests/:id/report', async (request, response) => {
    const { id } = request.params

    try {
      let updatedRequest = null

      if (dbContext.isConnected()) {
        const doc = await HelpRequest.findById(id)
        if (!doc) {
          return response.status(404).json({ error: 'Request not found' })
        }
        doc.reports = (doc.reports || 0) + 1
        if (doc.reports >= 3) {
          doc.status = 'flagged'
        }
        await doc.save()
        updatedRequest = formatReq(doc)
      } else {
        const reqIndex = inMemoryRequests.findIndex(r => r.id === id)
        if (reqIndex === -1) {
          return response.status(404).json({ error: 'Request not found' })
        }
        const req = inMemoryRequests[reqIndex]
        req.reports = (req.reports || 0) + 1
        if (req.reports >= 3) {
          req.status = 'flagged'
        }
        req.updatedAt = new Date().toISOString()
        inMemoryRequests[reqIndex] = req
        updatedRequest = req
      }

      io.emit('request:updated', updatedRequest)
      return response.json({ data: { success: true, reports: updatedRequest.reports, status: updatedRequest.status } })
    } catch (err) {
      console.error(err)
      return response.status(500).json({ error: 'Abuse report processing failed' })
    }
  })

  // 5. ANALYZE TEXT WITH AI AGENTS PIPELINE (END-POINT DEMO)
  app.post('/api/v1/requests/analyze-ai', async (request, response) => {
    const { title, description } = request.body
    if (!title || !description) {
      return response.status(400).json({ error: 'title and description are required' })
    }
    
    try {
      const result = await runAIAgents(title, description)
      return response.json({ data: result })
    } catch (err) {
      return response.status(500).json({ error: 'AI analysis failed' })
    }
  })

  // Handle Chat Session Sockets with strict privacy checks
  io.on('connection', (socket) => {
    socket.on('chat:join', async ({ requestId, userId }) => {
      if (!requestId || !userId) return
      
      const req = dbContext.isConnected()
        ? await HelpRequest.findById(requestId)
        : inMemoryRequests.find(r => r.id === requestId)
      
      if (req) {
        const requesterId = req.toObject ? req.requesterId : req.requesterId
        const helperId = req.toObject ? req.helperId : req.helperId
        
        if (userId === requesterId || userId === helperId) {
          socket.join(`room:${requestId}`)
        }
      }
    })

    socket.on('chat:leave', ({ requestId }) => {
      socket.leave(`room:${requestId}`)
    })

    socket.on('chat:send', async ({ requestId, text, senderId, senderName }) => {
      if (!requestId || !text || !senderId) return

      const req = dbContext.isConnected()
        ? await HelpRequest.findById(requestId)
        : inMemoryRequests.find(r => r.id === requestId)
      
      if (!req) return
      const requesterId = req.toObject ? req.requesterId : req.requesterId
      const helperId = req.toObject ? req.helperId : req.helperId
      
      // Enforce participant verification on backend
      if (senderId !== requesterId && senderId !== helperId) {
        return
      }

      const messageData = {
        senderId,
        senderName,
        text,
        createdAt: new Date().toISOString()
      }

      if (dbContext.isConnected()) {
        try {
          await HelpRequest.findByIdAndUpdate(
            requestId,
            { $push: { messages: messageData } }
          )
        } catch (err) {
          console.error('Failed to save message to MongoDB:', err)
        }
      } else {
        const inMemoryReq = inMemoryRequests.find(r => r.id === requestId)
        if (inMemoryReq) {
          if (!inMemoryReq.messages) inMemoryReq.messages = []
          inMemoryReq.messages.push(messageData)
        }
      }

      io.to(`room:${requestId}`).emit('chat:message', {
        requestId,
        message: messageData
      })
    })
  })
}
