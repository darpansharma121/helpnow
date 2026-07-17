import { randomUUID } from 'node:crypto'
import { HelpRequest } from '../models/HelpRequest.js'

// In-memory array fallback (if MongoDB is disconnected)
const inMemoryRequests = [
  {
    id: 'req-1',
    requesterId: 'user-aarav',
    requesterName: 'Aarav Kumar',
    requesterPhone: '+91 98765 43210',
    title: 'Need O+ blood donor',
    description: 'Urgent need for O+ blood donation for surgery at City Hospital. Any verified donor, please reach out as soon as possible.',
    category: 'medical',
    urgency: 'critical',
    status: 'open',
    location: { lat: 26.1730, lng: 91.7580, label: 'City Hospital, Guwahati' },
    reports: 0,
    aiSummary: 'Critical need for O+ blood donation at City Hospital for an upcoming surgery.',
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    acceptedAt: null,
    resolvedAt: null,
    helperId: null,
    helperName: null,
    helperPhone: null
  },
  {
    id: 'req-2',
    requesterId: 'user-priya',
    requesterName: 'Priya Sharma',
    requesterPhone: '+91 98765 99999',
    title: 'Bike puncture on GS Road',
    description: 'My scooter got punctured near Bhangagarh flyover on GS Road. I do not have a spare wheel. Need help locating a nearby mechanic or tools.',
    category: 'transport',
    urgency: 'urgent',
    status: 'open',
    location: { lat: 26.1610, lng: 91.7670, label: 'Bhangagarh Flyover, GS Road' },
    reports: 0,
    aiSummary: 'Roadside transport help needed near Bhangagarh flyover due to a bike tire puncture.',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    acceptedAt: null,
    resolvedAt: null,
    helperId: null,
    helperName: null,
    helperPhone: null
  },
  {
    id: 'req-3',
    requesterId: 'user-kabir',
    requesterName: 'Kabir Das',
    requesterPhone: '+91 99988 87766',
    title: 'Medicine pickup for senior',
    description: 'Need someone to pick up insulin from Zoo Road Pharmacy and deliver it to Zoo Road Path. Requester is an elderly individual unable to step out.',
    category: 'essentials',
    urgency: 'normal',
    status: 'open',
    location: { lat: 26.1680, lng: 91.7820, label: 'Zoo Road Pharmacy, Zoo Road' },
    reports: 0,
    aiSummary: 'Pickup of insulin from Zoo Road Pharmacy and delivery to a senior resident nearby.',
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    acceptedAt: null,
    resolvedAt: null,
    helperId: null,
    helperName: null,
    helperPhone: null
  }
]

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

export function registerRequestRoutes(app, io, dbContext) {
  let isSeeded = false

  // Seeding MongoDB helper
  async function seedMongoDB() {
    if (isSeeded) return
    try {
      const count = await HelpRequest.countDocuments()
      if (count === 0) {
        console.log('MongoDB collection is empty. Seeding initial data...')
        const seedItems = inMemoryRequests.map(r => {
          const { id, ...rest } = r
          return rest
        })
        await HelpRequest.insertMany(seedItems)
        console.log('MongoDB successfully seeded.')
      }
      isSeeded = true
    } catch (err) {
      console.error('Failed to seed MongoDB collection:', err.message)
    }
  }

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

  // 1. GET ALL REQUESTS
  app.get('/api/v1/requests', async (_request, response) => {
    try {
      if (dbContext.isConnected()) {
        await seedMongoDB()
        // Query database
        const dbDocs = await HelpRequest.find().sort({ createdAt: -1 })
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
        // In-memory fallback sorting
        const sorted = [...inMemoryRequests].sort((a, b) => {
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
