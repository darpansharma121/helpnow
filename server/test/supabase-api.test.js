import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { registerRequestRoutes, validateRequest } from '../src/routes/requests.js'
import { authenticateSupabaseToken } from '../src/supabase.js'

const app = express()
const io = {
  use() {},
  on() {},
  to() { return { emit() {} } }
}
let server
let baseUrl

before(async () => {
  app.use(express.json())
  registerRequestRoutes(app, io)
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }))
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('protected request endpoints reject callers without a Supabase session', async () => {
  const endpoints = [
    ['/api/v1/requests', 'GET'],
    ['/api/v1/requests', 'POST'],
    ['/api/v1/requests/example/accept', 'POST'],
    ['/api/v1/requests/example/status', 'PATCH'],
    ['/api/v1/requests/example/report', 'POST'],
    ['/api/v1/requests/analyze-ai', 'POST']
  ]

  for (const [path, method] of endpoints) {
    const response = await fetch(`${baseUrl}${path}`, { method })
    assert.equal(response.status, 401, `${method} ${path} should require a session`)
    assert.match((await response.json()).error, /sign in/i)
  }
})

test('request server validation rejects invalid values and accepts a valid draft', () => {
  assert.ok(validateRequest({ description: 'Too short' }).length > 0)
  assert.ok(validateRequest({
    title: 'Need groceries',
    description: 'Could someone help pick up a few groceries?',
    category: 'essentials',
    urgency: 'normal',
    location: { lat: 95, lng: 91.7, label: 'Invalid coordinates' }
  }).some((error) => error.includes('latitude')))
  assert.deepEqual(validateRequest({
    title: 'Need groceries',
    description: 'Could someone help pick up a few groceries?',
    category: 'essentials',
    urgency: 'normal',
    location: { lat: 26.14, lng: 91.74, label: 'Approximate area' }
  }), [])
})

test('Supabase rejects invalid JWTs as unauthenticated instead of reporting an auth outage', async () => {
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_ANON_KEY
  const originalFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 'bad_jwt',
    message: 'invalid JWT',
    statusCode: 403
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  })

  try {
    assert.equal(await authenticateSupabaseToken('invalid-test-token'), null)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = originalKey
  }
})

test('Supabase Auth token lookup retries transient network failures', async () => {
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_ANON_KEY
  const originalFetch = globalThis.fetch
  let attempts = 0
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts < 3) throw new TypeError('Temporary network failure')
    return new Response(JSON.stringify({
      code: 'bad_jwt',
      message: 'invalid JWT',
      statusCode: 401
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    assert.equal(await authenticateSupabaseToken('invalid-test-token'), null)
    assert.equal(attempts, 3)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = originalKey
  }
})
