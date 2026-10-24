import { authenticateSupabaseToken } from '../supabase.js'

const allowedUrgencies = new Set(['normal', 'urgent', 'critical'])
const allowedCategories = new Set(['medical', 'transport', 'essentials', 'other'])
const allowedStatuses = new Set(['in_progress', 'resolved', 'cancelled', 'unfulfilled', 'open'])

function hasValidRequestId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

export function validateRequest(body) {
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const errors = []
  if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') {
    errors.push('title must be a string')
  } else if (typeof body.title === 'string' && body.title.trim().length > 120) {
    errors.push('title must be 120 characters or fewer')
  }

  if (typeof body.description !== 'string' || body.description.trim().length < 10 || body.description.trim().length > 2000) {
    errors.push('description must be between 10 and 2000 characters')
  }
  if (typeof body.category !== 'string' || !allowedCategories.has(body.category.trim().toLowerCase())) {
    errors.push('category must be medical, transport, essentials, or other')
  }
  if (!allowedUrgencies.has(body.urgency)) {
    errors.push('urgency must be normal, urgent, or critical')
  }
  if (!body.location || typeof body.location.lat !== 'number' || !Number.isFinite(body.location.lat) ||
    body.location.lat < -90 || body.location.lat > 90 || typeof body.location.lng !== 'number' ||
    !Number.isFinite(body.location.lng) || body.location.lng < -180 || body.location.lng > 180) {
    errors.push('location must contain valid latitude and longitude coordinates')
  } else if (typeof body.location.label !== 'string' || !body.location.label.trim() || body.location.label.length > 200) {
    errors.push('location label is required and must be 200 characters or fewer')
  }
  return errors
}

async function runAIAgents(title, description) {
  const text = `${title} ${description}`.toLowerCase()
  const fallback = () => {
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
    const cleanTitle = title.trim() || description.trim()
    const summary = cleanTitle.length > 50 ? `${cleanTitle.substring(0, 50)}...` : cleanTitle
    return {
      isSpam: /\b(viagra|casino|earn money|crypto investment|click link|subscribe|advertisement)\b/.test(text),
      category,
      urgency,
      aiSummary: `[Local AI] Need: ${summary}`
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fallback()
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Analyze this neighborhood help request. Title: "${title}". Description: "${description}". Return JSON with isSpam boolean, category medical|transport|essentials|other, urgency normal|urgent|critical, and aiSummary under 80 characters.` }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    )
    if (!response.ok) {
      console.warn('Gemini API returned error code:', response.status)
      return fallback()
    }
    const result = await response.json()
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text
    if (!jsonText) return fallback()
    const parsed = JSON.parse(jsonText)
    if (typeof parsed.isSpam !== 'boolean' || !allowedCategories.has(parsed.category) ||
      !allowedUrgencies.has(parsed.urgency) || typeof parsed.aiSummary !== 'string') return fallback()
    return parsed
  } catch (error) {
    console.error('Failed to run Gemini AI agents; using local classification:', error.message)
    return fallback()
  }
}

function relation(row, name) {
  const value = row[name]
  return Array.isArray(value) ? value[0] || null : value || null
}

function publicRequest(row, userId, messages = []) {
  const assignment = relation(row, 'help_assignments')
  const isParticipant = userId === row.requester_id || userId === assignment?.helper_id
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    title: row.title,
    description: row.description,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    location: {
      lat: Number(row.latitude.toFixed(2)),
      lng: Number(row.longitude.toFixed(2)),
      label: 'Approximate area'
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: assignment?.accepted_at || null,
    inProgressAt: row.in_progress_at,
    resolvedAt: row.resolved_at,
    unfulfilledAt: row.unfulfilled_at,
    helperId: isParticipant ? assignment?.helper_id || null : null,
    helperName: isParticipant ? assignment?.helper_name || null : null,
    requesterPhone: null,
    helperPhone: null,
    messages: isParticipant ? messages : [],
    aiSummary: row.ai_summary,
    reports: row.reports
  }
}

async function loadRequest(client, id) {
  const { data, error } = await client
    .from('help_requests')
    .select('id, requester_id, requester_name, title, description, category, urgency, status, latitude, longitude, ai_summary, reports, in_progress_at, resolved_at, unfulfilled_at, created_at, updated_at, help_assignments(request_id, requester_id, helper_id, helper_name, accepted_at)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

async function loadMessages(client, rows, userId) {
  const ids = rows
    .filter((row) => userId === row.requester_id || userId === relation(row, 'help_assignments')?.helper_id)
    .map((row) => row.id)
  if (!ids.length) return new Map()
  const { data, error } = await client
    .from('help_messages')
    .select('request_id, sender_id, sender_name, text, created_at')
    .in('request_id', ids)
    .order('created_at', { ascending: true })
  if (error) throw error
  const messages = new Map()
  for (const item of data || []) {
    if (!messages.has(item.request_id)) messages.set(item.request_id, [])
    messages.get(item.request_id).push({
      senderId: item.sender_id,
      senderName: item.sender_name,
      text: item.text,
      createdAt: item.created_at
    })
  }
  return messages
}

function errorResponse(response, error, fallback) {
  const message = error?.message || fallback
  if (/cannot accept your own|not allowed|cannot report your own|paused for your account/i.test(message)) {
    return response.status(403).json({ error: message })
  }
  if (/already reported|already assigned|no longer open|changed|status|request not found|not found/i.test(message)) {
    return response.status(/not found/i.test(message) ? 404 : 409).json({ error: message })
  }
  console.error(fallback, error)
  return response.status(500).json({ error: fallback })
}

export function registerRequestRoutes(app, io) {
  async function requireUser(request, response) {
    const token = request.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) {
      response.status(401).json({ error: 'Sign in to continue.' })
      return null
    }
    try {
      const session = await authenticateSupabaseToken(token)
      if (!session) response.status(401).json({ error: 'Your session has expired. Sign in again.' })
      return session
    } catch (error) {
      console.error('Request authentication lookup failed:', error)
      response.status(503).json({ error: 'Account service is temporarily unavailable.' })
      return null
    }
  }

  function broadcastRequest(event, row) {
    const sockets = io.sockets?.sockets
    if (!sockets?.values) return
    for (const socket of sockets.values()) {
      const assignment = relation(row, 'help_assignments')
      const isParticipant = socket.data.userId === row.requester_id ||
        socket.data.userId === assignment?.helper_id
      if (row.status !== 'open' && !isParticipant) {
        socket.emit('request:removed', { id: row.id })
        continue
      }
      socket.emit(event, publicRequest(row, socket.data.userId))
    }
  }

  app.get('/api/v1/requests', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    try {
      const { data, error } = await session.client
        .from('help_requests')
        .select('id, requester_id, requester_name, title, description, category, urgency, status, latitude, longitude, ai_summary, reports, in_progress_at, resolved_at, unfulfilled_at, created_at, updated_at, help_assignments(request_id, requester_id, helper_id, helper_name, accepted_at)')
        .order('created_at', { ascending: false })
      if (error) throw error
      const messageMap = await loadMessages(session.client, data || [], session.user.id)
      const requests = (data || []).map((item) => publicRequest(item, session.user.id, messageMap.get(item.id) || []))
      requests.sort((a, b) => {
        const aActive = !['resolved', 'cancelled', 'unfulfilled', 'flagged'].includes(a.status)
        const bActive = !['resolved', 'cancelled', 'unfulfilled', 'flagged'].includes(b.status)
        if (aActive !== bActive) return aActive ? -1 : 1
        const weight = { critical: 3, urgent: 2, normal: 1 }
        return aActive
          ? (weight[b.urgency] || 0) - (weight[a.urgency] || 0) || new Date(b.createdAt) - new Date(a.createdAt)
          : new Date(b.createdAt) - new Date(a.createdAt)
      })
      return response.json({ data: requests })
    } catch (error) {
      return errorResponse(response, error, 'Unable to load help requests.')
    }
  })

  app.post('/api/v1/requests', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    const errors = validateRequest(request.body)
    if (errors.length) return response.status(400).json({ error: 'Invalid request', details: errors })

    try {
      const { title, description, category, urgency, location } = request.body
      const aiResult = await runAIAgents(title || description, description)
      const finalTitle = title?.trim() || (description.length > 40
        ? `${description.substring(0, 40).trim()}...`
        : description.trim())
      const { data, error } = await session.client
        .from('help_requests')
        .insert({
          requester_id: session.user.id,
          requester_name: session.user.name,
          title: finalTitle,
          description: description.trim(),
          category: aiResult.category || category.toLowerCase(),
          urgency: aiResult.urgency || urgency,
          latitude: Math.round(location.lat * 100) / 100,
          longitude: Math.round(location.lng * 100) / 100,
          location_label: location.label.trim(),
          status: aiResult.isSpam ? 'flagged' : 'open',
          ai_summary: aiResult.aiSummary
        })
        .select('id, requester_id, requester_name, title, description, category, urgency, status, latitude, longitude, ai_summary, reports, in_progress_at, resolved_at, unfulfilled_at, created_at, updated_at, help_assignments(request_id, requester_id, helper_id, helper_name, accepted_at)')
        .single()
      if (error) throw error
      if (data.status !== 'flagged') broadcastRequest('request:created', data)
      return response.status(201).json({ data: publicRequest(data, session.user.id) })
    } catch (error) {
      return errorResponse(response, error, 'Failed to create help request.')
    }
  })

  app.post('/api/v1/requests/:id/accept', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    if (!hasValidRequestId(request.params.id)) return response.status(400).json({ error: 'Invalid request ID.' })
    try {
      const { error } = await session.client.rpc('claim_help_request', { p_request_id: request.params.id })
      if (error) throw error
      const updated = await loadRequest(session.client, request.params.id)
      if (!updated) return response.status(404).json({ error: 'Request not found.' })
      broadcastRequest('request:updated', updated)
      return response.json({ data: publicRequest(updated, session.user.id) })
    } catch (error) {
      return errorResponse(response, error, 'Unable to accept this request.')
    }
  })

  app.patch('/api/v1/requests/:id/status', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    if (!hasValidRequestId(request.params.id)) return response.status(400).json({ error: 'Invalid request ID.' })
    if (!allowedStatuses.has(request.body?.status)) return response.status(400).json({ error: 'Invalid status.' })
    try {
      const { error } = await session.client.rpc('transition_help_request', {
        p_request_id: request.params.id,
        p_status: request.body.status
      })
      if (error) throw error
      const updated = await loadRequest(session.client, request.params.id)
      if (!updated) return response.status(404).json({ error: 'Request not found.' })
      broadcastRequest('request:updated', updated)
      return response.json({ data: publicRequest(updated, session.user.id) })
    } catch (error) {
      return errorResponse(response, error, 'Unable to update request status.')
    }
  })

  app.post('/api/v1/requests/:id/report', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    if (!hasValidRequestId(request.params.id)) return response.status(400).json({ error: 'Invalid request ID.' })
    try {
      const { data, error } = await session.client.rpc('report_help_request', { p_request_id: request.params.id })
      if (error) throw error
      const updated = await loadRequest(session.client, request.params.id)
      if (updated) broadcastRequest('request:updated', updated)
      return response.json({ data: { success: true, reports: data.reports, status: data.status } })
    } catch (error) {
      return errorResponse(response, error, 'Abuse report processing failed.')
    }
  })

  app.post('/api/v1/requests/analyze-ai', async (request, response) => {
    const session = await requireUser(request, response)
    if (!session) return
    const { title, description } = request.body || {}
    if (typeof title !== 'string' || typeof description !== 'string' ||
      (!title.trim() && !description.trim()) || title.length > 120 || description.length > 2000) {
      return response.status(400).json({ error: 'Enter a title or description within the supported length.' })
    }
    try {
      return response.json({ data: await runAIAgents(title, description) })
    } catch (error) {
      return errorResponse(response, error, 'AI analysis failed.')
    }
  })

  io.use(async (socket, next) => {
    try {
      const session = await authenticateSupabaseToken(socket.handshake.auth?.token)
      if (!session) return next(new Error('Authentication required'))
      socket.data.userId = session.user.id
      socket.data.userName = session.user.name
      socket.data.supabase = session.client
      return next()
    } catch (error) {
      console.error('Socket authentication failed:', error)
      return next(new Error('Authentication failed'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('chat:join', async ({ requestId } = {}) => {
      if (!requestId) return
      const { data, error } = await socket.data.supabase
        .from('help_requests')
        .select('id, requester_id, help_assignments(helper_id)')
        .eq('id', requestId)
        .maybeSingle()
      if (error) {
        console.error('Unable to authorize chat room:', error)
        return
      }
      const assignment = data && relation(data, 'help_assignments')
      if (data && (socket.data.userId === data.requester_id || socket.data.userId === assignment?.helper_id)) {
        socket.join(`room:${requestId}`)
      }
    })

    socket.on('chat:leave', ({ requestId } = {}) => {
      if (requestId) socket.leave(`room:${requestId}`)
    })

    socket.on('chat:send', async ({ requestId, text } = {}) => {
      if (!requestId || typeof text !== 'string' || !text.trim() || text.trim().length > 1000) return
      const { data: requestRow, error: requestError } = await socket.data.supabase
        .from('help_requests')
        .select('id, requester_id, requester_name, help_assignments(helper_id, helper_name)')
        .eq('id', requestId)
        .maybeSingle()
      if (requestError) {
        console.error('Unable to verify chat participant:', requestError)
        return
      }
      const assignment = requestRow && relation(requestRow, 'help_assignments')
      const isRequester = socket.data.userId === requestRow?.requester_id
      const isHelper = socket.data.userId === assignment?.helper_id
      if (!requestRow || (!isRequester && !isHelper)) return
      const message = {
        request_id: requestId,
        sender_id: socket.data.userId,
        sender_name: isRequester ? requestRow.requester_name : assignment.helper_name,
        text: text.trim()
      }
      const { data, error } = await socket.data.supabase
        .from('help_messages')
        .insert(message)
        .select('sender_id, sender_name, text, created_at')
        .single()
      if (error) {
        console.error('Unable to save chat message:', error)
        return
      }
      io.to(`room:${requestId}`).emit('chat:message', {
        requestId,
        message: {
          senderId: data.sender_id,
          senderName: data.sender_name,
          text: data.text,
          createdAt: data.created_at
        }
      })
    })
  })
}
