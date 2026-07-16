import { randomUUID } from 'node:crypto'

const requests = []
const allowedUrgencies = new Set(['normal', 'urgent', 'critical'])

function validateRequest(body) {
  const errors = []
  if (typeof body.title !== 'string' || body.title.trim().length < 5) errors.push('title must be at least 5 characters')
  if (typeof body.description !== 'string' || body.description.trim().length < 10) errors.push('description must be at least 10 characters')
  if (typeof body.category !== 'string' || !body.category.trim()) errors.push('category is required')
  if (!allowedUrgencies.has(body.urgency)) errors.push('urgency must be normal, urgent, or critical')
  return errors
}

export function registerRequestRoutes(app, io) {
  app.get('/api/v1/requests', (_request, response) => response.json({ data: requests }))
  app.post('/api/v1/requests', (request, response) => {
    const errors = validateRequest(request.body)
    if (errors.length) return response.status(400).json({ error: 'Invalid request', details: errors })
    const helpRequest = { id: randomUUID(), title: request.body.title.trim(), description: request.body.description.trim(), category: request.body.category.trim().toLowerCase(), urgency: request.body.urgency, location: request.body.location ?? null, status: 'open', createdAt: new Date().toISOString() }
    requests.unshift(helpRequest)
    io.emit('request:created', helpRequest)
    return response.status(201).json({ data: helpRequest })
  })
}
