import { StrictMode, useState, useEffect, useRef, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { io } from 'socket.io-client'
import { supabase } from './supabase'
import L from 'leaflet'
import {
  AlertCircle,
  MapPin,
  User,
  Shield,
  Filter,
  CheckCircle,
  Clock,
  Plus,
  Search,
  Sparkles,
  X,
  Flag,
  HelpCircle,
  Info,
  Layers,
  ArrowRight,
  Navigation,
  MessageSquare
} from 'lucide-react'
import './styles.css'

// Category styles and display names
const CATEGORIES = {
  medical: { label: 'Medical Support', color: 'text-rose-600 bg-rose-50 border-rose-100', badge: 'bg-rose-500' },
  transport: { label: 'Transport / Roadside', color: 'text-amber-600 bg-amber-50 border-amber-100', badge: 'bg-amber-500' },
  essentials: { label: 'Daily Essentials', color: 'text-sky-600 bg-sky-50 border-sky-100', badge: 'bg-sky-500' },
  other: { label: 'Other Support', color: 'text-purple-600 bg-purple-50 border-purple-100', badge: 'bg-purple-500' }
}

// Dynamic deploy-ready API & Socket endpoints
const API_URL = import.meta.env.VITE_API_URL || (window.location.origin + '/api/v1')
const SOCKET_URL = API_URL.replace('/api/v1', '')

async function readJsonResponse(response) {
  const body = await response.text()
  if (!body.trim()) {
    if (response.status === 204) return null
    throw new Error(`The server returned an empty response (HTTP ${response.status}). Check that the HelpNow API is running and the client is using the correct API URL.`)
  }

  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}). Check that the client is connected to the HelpNow API.`)
  }
}

// GraphHopper API Key (Client-side)
const GRAPHHOPPER_API_KEY = import.meta.env.VITE_GRAPHHOPPER_API_KEY || ''

function formatGraphHopperAddress(hit) {
  if (!hit) return ''
  const parts = [
    hit.name,
    hit.street && hit.street !== hit.name ? hit.street : null,
    hit.city,
    hit.state,
    hit.country
  ].filter(Boolean)
  const unique = parts.filter((part, idx) => parts.indexOf(part) === idx)
  return unique.join(', ') || hit.name || 'Selected Location'
}

async function reverseGeocodeLocation(lat, lng) {
  if (GRAPHHOPPER_API_KEY) {
    try {
      const url = `https://graphhopper.com/api/1/geocode?point=${lat},${lng}&reverse=true&locale=en&key=${GRAPHHOPPER_API_KEY}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await readJsonResponse(response)
        if (data?.hits?.[0]) {
          const address = formatGraphHopperAddress(data.hits[0])
          if (address) return address
        }
      }
    } catch (error) {
      console.warn('GraphHopper reverse geocoding failed, falling back to OSM:', error)
    }
  }

  // Graceful fallback to OpenStreetMap Nominatim
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`)
    if (response.ok) {
      const data = await readJsonResponse(response)
      if (data?.display_name) return data.display_name
    }
  } catch (error) {
    console.warn('Nominatim reverse geocoding failed:', error)
  }

  return `Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`
}

async function searchGeocodeLocation(query) {
  if (!query || !query.trim()) return []

  if (GRAPHHOPPER_API_KEY) {
    try {
      const url = `https://graphhopper.com/api/1/geocode?q=${encodeURIComponent(query.trim())}&limit=5&locale=en&key=${GRAPHHOPPER_API_KEY}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await readJsonResponse(response)
        if (Array.isArray(data?.hits) && data.hits.length > 0) {
          return data.hits.map((hit) => ({
            lat: hit.point.lat,
            lon: hit.point.lng,
            display_name: formatGraphHopperAddress(hit)
          }))
        }
      }
    } catch (error) {
      console.warn('GraphHopper search geocoding failed, falling back to OSM:', error)
    }
  }

  // Graceful fallback to OpenStreetMap Nominatim
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.trim())}&limit=5`)
    if (response.ok) {
      const data = await readJsonResponse(response)
      return (data || []).map((item) => ({
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        display_name: item.display_name
      }))
    }
  } catch (error) {
    console.warn('Nominatim search geocoding failed:', error)
  }

  return []
}

async function fetchRoutePolyline(startLat, startLng, destLat, destLng) {
  if (!GRAPHHOPPER_API_KEY) return null
  try {
    const url = `https://graphhopper.com/api/1/route?point=${startLat},${startLng}&point=${destLat},${destLng}&vehicle=car&locale=en&calc_points=true&points_encoded=false&key=${GRAPHHOPPER_API_KEY}`
    const response = await fetch(url)
    if (!response.ok) return null
    const data = await readJsonResponse(response)
    const path = data?.paths?.[0]
    if (!path?.points?.coordinates) return null
    return {
      distanceMeters: path.distance,
      timeMs: path.time,
      coordinates: path.points.coordinates.map(([lng, lat]) => [lat, lng])
    }
  } catch (error) {
    console.warn('GraphHopper route fetch failed:', error)
    return null
  }
}

function App() {
  const [requests, setRequests] = useState([])
  const [authToken, setAuthToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [authMode, setAuthMode] = useState('register')
  const [authIntent, setAuthIntent] = useState('')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  const [isLoadingRequests, setIsLoadingRequests] = useState(false)
  const [requestLoadError, setRequestLoadError] = useState('')
  const [requestReloadKey, setRequestReloadKey] = useState(0)
  const [requestScope, setRequestScope] = useState('available')
  const [selectedRequestId, setSelectedRequestId] = useState(null)

  // Filters state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedUrgency, setSelectedUrgency] = useState('all')
  const [showActiveOnly, setShowActiveOnly] = useState(true)

  // Request creation state
  const [isCreatingRequest, setIsCreatingRequest] = useState(false)
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [newRequest, setNewRequest] = useState({
    title: '',
    description: '',
    category: 'essentials',
    urgency: 'normal'
  })
  const [newRequestLocation, setNewRequestLocation] = useState(null) // { lat, lng, label }
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState(null)

  // Geolocation state
  const [isLocatingGPS, setIsLocatingGPS] = useState(false)

  // Map Search state
  const [mapSearchQuery, setMapSearchQuery] = useState('')
  const [mapSearchResults, setMapSearchResults] = useState([])
  const [isSearchingMap, setIsSearchingMap] = useState(false)

  // UI state
  const [mapVisible, setMapVisible] = useState(true)
  const [toasts, setToasts] = useState([])
  const [socketConnected, setSocketConnected] = useState(false)
  const [socketError, setSocketError] = useState(null)
  const [detailTab, setDetailTab] = useState('info')
  const [chatText, setChatText] = useState('')
  const chatEndRef = useRef(null)
  const socketRef = useRef(null)

  // Map references
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef({})
  const creationMarkerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const [activeRouteInfo, setActiveRouteInfo] = useState(null)
  const [isLoadingRoute, setIsLoadingRoute] = useState(false)

  const activeUser = currentUser
  const activeUserRef = useRef(activeUser)

  useEffect(() => {
    activeUserRef.current = activeUser
  }, [activeUser])

  useEffect(() => {
    if (!supabase) {
      setAuthError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env.')
      setIsRestoringSession(false)
      return undefined
    }

    let mounted = true
    const applySession = (session) => {
      const user = session?.user
      setAuthToken(session?.access_token || '')
      setCurrentUser(user ? {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email?.split('@')[0] || 'Community member'
      } : null)
      setIsRestoringSession(false)
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) applySession(session)
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setAuthError(`Unable to restore your session: ${error.message}`)
      applySession(data.session)
    }).catch((error) => {
      if (!mounted) return
      setAuthError(`Unable to restore your session: ${error.message}`)
      setIsRestoringSession(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setIsAuthLoading(true)
    setAuthError('')
    try {
      if (!supabase) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env.')
      const result = authMode === 'register'
        ? await supabase.auth.signUp({
          email: authForm.email.trim(),
          password: authForm.password,
          options: { data: { name: authForm.name.trim() } }
        })
        : await supabase.auth.signInWithPassword({
          email: authForm.email.trim(),
          password: authForm.password
        })
      if (result.error) throw result.error
      setAuthForm({ name: '', email: '', password: '' })
      if (authMode === 'register' && !result.data.session) {
        setAuthError('Check your email to confirm your account, then sign in.')
      }
      if (authIntent === 'ask' || authIntent === 'voice') {
        setRequestScope('created')
        setIsCreatingRequest(true)
      } else if (authIntent === 'offer') {
        setRequestScope('available')
        setIsCreatingRequest(false)
      }
    } catch (error) {
      setAuthError(error.message || 'Unable to connect. Please try again.')
    } finally {
      setIsAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    if (!supabase) return
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        addToast('Sign out failed', error.message, 'danger')
        return
      }
      setRequests([])
      setSelectedRequestId(null)
      setIsCreatingRequest(false)
    } catch (error) {
      addToast('Sign out failed', error.message || 'Unable to end your session.', 'danger')
    }
  }

  const handleVoiceDraft = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setIsCreatingRequest(true)
      addToast('Voice input unavailable', 'Your browser does not support speech recognition. You can still type your request.', 'info')
      return
    }

    setIsCreatingRequest(true)
    const recognition = new Recognition()
    recognition.lang = navigator.language || 'en-IN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim()
      if (transcript) {
        const description = [newRequest.description, transcript].filter(Boolean).join(' ')
        setNewRequest((previous) => ({
          ...previous,
          description
        }))
        setIsAnalyzingAI(true)
        fetch(`${API_URL}/requests/analyze-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ title: newRequest.title, description })
        })
          .then(async (response) => {
            const result = await readJsonResponse(response)
            if (!response.ok) throw new Error(result.error || 'AI analysis failed.')
            setAiSuggestions(result.data)
            setNewRequest((previous) => ({
              ...previous,
              category: result.data.category,
              urgency: result.data.urgency
            }))
            addToast('Voice draft ready', 'Review the transcript and AI suggestions, choose a location, and confirm before publishing.', 'success')
          })
          .catch((error) => {
            console.error('Voice draft analysis failed:', error)
            addToast('Voice draft ready', 'Review the transcript and complete the details before publishing. AI suggestions are unavailable.', 'warning')
          })
          .finally(() => setIsAnalyzingAI(false))
      }
    }
    recognition.onerror = () => addToast('Voice input failed', 'Please try again or type your request instead.', 'warning')
    try {
      recognition.start()
    } catch (error) {
      console.error('Unable to start browser speech recognition:', error)
      addToast('Voice input failed', 'Allow microphone access or type your request instead.', 'warning')
    }
  }

  // Add toast notification helper
  const addToast = (title, message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, title, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }

  // Socket.IO is authenticated with the same short-lived access token as the API.
  useEffect(() => {
    if (!authToken || !currentUser) return undefined
    console.log('Connecting to Socket.IO at', SOCKET_URL)
    const socket = io(SOCKET_URL, { auth: { token: authToken } })
    socketRef.current = socket

    socket.on('connect', () => {
      setSocketConnected(true)
      setSocketError(null)
      console.log('Socket.IO connected successfully.')
    })

    socket.on('connect_error', (err) => {
      setSocketConnected(false)
      setSocketError('Sync Connection offline')
      console.error('Socket connection error:', err)
    })

    socket.on('server:ready', (data) => {
      console.log('Server ready confirmation:', data)
    })

    // Listen for new requests
    socket.on('request:created', (newReq) => {
      setRequests((prev) => {
        if (prev.some((r) => r.id === newReq.id)) return prev
        return [newReq, ...prev]
      })
      
      // Trigger toast notification if not self-created
      if (newReq.requesterId !== activeUserRef.current?.id) {
        const catLabel = CATEGORIES[newReq.category]?.label || 'General'
        addToast(
          `Alert: New Help Request`,
          `"${newReq.title}" posted near you under ${catLabel}.`,
          newReq.urgency === 'critical' ? 'danger' : 'info'
        )
      }
    })

    // Listen for status/report updates
    socket.on('request:updated', (updatedReq) => {
      setRequests((prev) => prev.map((r) => (r.id === updatedReq.id ? updatedReq : r)))
      
      setSelectedRequestId((currId) => {
        if (currId === updatedReq.id) {
          if (updatedReq.status === 'flagged') {
            addToast('Request Flagged', 'This request has been removed after multiple abuse reports.', 'warning')
            return null
          }
        }
        return currId
      })
    })

    socket.on('request:removed', ({ id }) => {
      setRequests((previous) => previous.filter((request) => request.id !== id))
      setSelectedRequestId((currentId) => currentId === id ? null : currentId)
    })

    // Listen for real-time chat messages
    socket.on('chat:message', ({ requestId, message }) => {
      setRequests((prev) => prev.map((r) => {
        if (r.id === requestId) {
          const msgs = r.messages || []
          if (msgs.some(m => m.createdAt === message.createdAt && m.senderId === message.senderId && m.text === message.text)) {
            return r
          }
          return {
            ...r,
            messages: [...msgs, message]
          }
        }
        return r
      }))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [authToken, currentUser])

  // Join/Leave Chat Rooms dynamically
  useEffect(() => {
    if (socketRef.current && selectedRequestId) {
      socketRef.current.emit('chat:join', { requestId: selectedRequestId })
      return () => {
        socketRef.current.emit('chat:leave', { requestId: selectedRequestId })
      }
    }
  }, [selectedRequestId, socketConnected, currentUser])

  // Reset tab to info and clear old route when request changes
  useEffect(() => {
    setDetailTab('info')
    if (routeLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(routeLayerRef.current)
      routeLayerRef.current = null
    }
    setActiveRouteInfo(null)
  }, [selectedRequestId])

  // Initial REST Fetch
  useEffect(() => {
    if (!authToken || !currentUser) return
    const fetchRequests = async () => {
      setIsLoadingRequests(true)
      setRequestLoadError('')
      try {
        const response = await fetch(`${API_URL}/requests`, {
          headers: { Authorization: `Bearer ${authToken}` }
        })
        const json = await readJsonResponse(response)
        if (!response.ok) throw new Error(json.error || 'Unable to load requests.')
        if (json.data) {
          setRequests(json.data)
        }
      } catch (err) {
        console.error('Failed to fetch requests:', err)
        setRequestLoadError(err.message || 'Unable to load requests.')
        addToast('Error', 'Unable to load requests from server.', 'danger')
      } finally {
        setIsLoadingRequests(false)
      }
    }
    fetchRequests()
  }, [authToken, currentUser, requestReloadKey])

  // ----------------------------------------------------
  // LEAFLET MAP INLINE INITIALIZATION
  // ----------------------------------------------------
  useEffect(() => {
    if (!mapInstanceRef.current && mapRef.current) {
      console.log('Initializing Leaflet map...')
      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([26.1600, 91.7650], 13.5)

      // Use standard OpenStreetMap tiles (100% free, no API key required)
      // or CARTO Positron if VITE_CARTO_API_KEY is configured
      const cartoKey = import.meta.env.VITE_CARTO_API_KEY
      const tileUrl = cartoKey
        ? `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map)

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      mapInstanceRef.current = map
    }

    return () => {
      if (routeLayerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(routeLayerRef.current)
        routeLayerRef.current = null
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [mapVisible])

  // Map Click Listener
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const handleMapClick = async (e) => {
      if (isCreatingRequest) {
        const { lat, lng } = e.latlng
        setNewRequestLocation({
          lat,
          lng,
          label: `Pinned Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`
        })
        
        try {
          const label = await reverseGeocodeLocation(lat, lng)
          if (label) {
            setNewRequestLocation({ lat, lng, label })
          }
        } catch (err) {
          console.warn('Reverse geocoding failed:', err)
        }
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [isCreatingRequest])

  // Synchronise request markers
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    // Clean up old markers
    Object.keys(markersRef.current).forEach((id) => {
      const request = requests.find((r) => r.id === id)
      if (!request || request.status === 'flagged') {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })

    // Add or update markers
    requests.forEach((req) => {
      if (!req.location || typeof req.location.lat !== 'number' || typeof req.location.lng !== 'number') return
      if (req.status === 'flagged') return

      const { lat, lng } = req.location
      const isNew = !markersRef.current[req.id]

      // Light theme styled markers
      let colorClass = 'bg-rose-500 shadow-rose-500/50 border-rose-200'
      if (req.status === 'resolved' || req.status === 'cancelled' || req.status === 'unfulfilled') {
        colorClass = 'bg-slate-400 shadow-slate-400/20 border-slate-355 opacity-55'
      } else if (req.urgency === 'critical') {
        colorClass = 'bg-rose-500 shadow-rose-500/70 border-white animate-pulse'
      } else if (req.urgency === 'urgent') {
        colorClass = 'bg-amber-500 shadow-amber-500/60 border-white'
      } else {
        colorClass = 'bg-sky-500 shadow-sky-500/50 border-white'
      }

      const htmlIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            ${req.urgency === 'critical' && req.status === 'open' ? '<div class="absolute w-6.5 h-6.5 bg-rose-500/25 rounded-full animate-ping"></div>' : ''}
            <div class="w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center ${colorClass} transition-all duration-300 transform hover:scale-130 shadow-md">
              <div class="w-1.5 h-1.5 rounded-full bg-white/40"></div>
            </div>
          </div>
        `,
        className: 'custom-leaflet-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })

      if (isNew) {
        const marker = L.marker([lat, lng], { icon: htmlIcon }).addTo(map)
        marker.on('click', () => {
          setSelectedRequestId(req.id)
          setIsCreatingRequest(false)
        })
        markersRef.current[req.id] = marker
      } else {
        markersRef.current[req.id].setIcon(htmlIcon)
        markersRef.current[req.id].setLatLng([lat, lng])
      }
    })
  }, [requests])

  // Manage Creation Pin Marker
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    if (isCreatingRequest && newRequestLocation) {
      const { lat, lng } = newRequestLocation
      if (creationMarkerRef.current) {
        creationMarkerRef.current.setLatLng([lat, lng])
      } else {
        const pinIcon = L.divIcon({
          html: `
            <div class="flex flex-col items-center select-none cursor-pointer">
              <div class="px-2 py-0.5 bg-rose-500 text-white text-4xs font-bold rounded shadow-md border border-rose-300 mb-0.5 uppercase tracking-wider">Drag to Move</div>
              <div class="w-6 h-6 flex items-center justify-center rounded-full bg-rose-500 border-2 border-white text-white font-bold shadow-lg shadow-rose-500/40 animate-bounce">
                📍
              </div>
            </div>
          `,
          className: 'creation-pin-marker',
          iconSize: [60, 60],
          iconAnchor: [30, 60]
        })

        const marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map)
        
        marker.on('dragend', async () => {
          const pos = marker.getLatLng()
          setNewRequestLocation({
            lat: pos.lat,
            lng: pos.lng,
            label: `Coordinates (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`
          })
          
          try {
            const label = await reverseGeocodeLocation(pos.lat, pos.lng)
            if (label) {
              setNewRequestLocation({
                lat: pos.lat,
                lng: pos.lng,
                label
              })
            }
          } catch (err) {
            console.warn('Reverse geocode failed on drag:', err)
          }
        })

        creationMarkerRef.current = marker
      }
      
      map.setView([newRequestLocation.lat, newRequestLocation.lng], map.getZoom())
    } else {
      if (creationMarkerRef.current) {
        creationMarkerRef.current.remove()
        creationMarkerRef.current = null
      }
    }
  }, [isCreatingRequest, newRequestLocation])

  // Pan to selected request marker
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !selectedRequestId) return
    const req = requests.find((r) => r.id === selectedRequestId)
    if (req && req.location) {
      map.setView([req.location.lat, req.location.lng], 14.5)
    }
  }, [selectedRequestId, requests])

  // ----------------------------------------------------
  // GPS GEOLOCATION METHOD
  // ----------------------------------------------------
  const handleGPSDetect = () => {
    if (!navigator.geolocation) {
      addToast('GPS Not Supported', 'Your browser does not support GPS location auto-detection.', 'warning')
      return
    }

    setIsLocatingGPS(true)
    addToast('GPS Active', 'Attempting to detect your coordinates...', 'info')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        
        setNewRequestLocation({
          lat: latitude,
          lng: longitude,
          label: `GPS Coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
        })

        try {
          const label = await reverseGeocodeLocation(latitude, longitude)
          if (label) {
            setNewRequestLocation({
              lat: latitude,
              lng: longitude,
              label
            })
            addToast('GPS Located', `Location resolved: ${label.split(', ')[0] || 'My Area'}`, 'success')
          }
        } catch (err) {
          console.error(err)
          addToast('GPS Coordinates Saved', 'Auto-resolved address failed, but coordinate pins are locked.', 'info')
        } finally {
          setIsLocatingGPS(false)
        }
      },
      (error) => {
        console.error(error)
        setIsLocatingGPS(false)
        addToast('GPS Fail', 'Access denied or timeout. Please check your browser permission settings.', 'warning')
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  // ----------------------------------------------------
  // FILTER LOGIC
  // ----------------------------------------------------
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (req.status === 'flagged') return false
      const isMine = req.requesterId === activeUser?.id
      const isHelping = req.helperId === activeUser?.id
      const inScope = requestScope === 'available'
        ? !isMine && req.status === 'open'
        : requestScope === 'created'
          ? isMine
          : requestScope === 'accepted'
            ? isHelping && ['accepted', 'in_progress'].includes(req.status)
            : (isMine || isHelping) && req.status === 'resolved'
      if (!inScope) return false

      const matchSearch =
        req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.description.toLowerCase().includes(searchQuery.toLowerCase())

      const matchCategory = selectedCategory === 'all' || req.category === selectedCategory
      const matchUrgency = selectedUrgency === 'all' || req.urgency === selectedUrgency
      const matchActive = !showActiveOnly ||
        !['resolved', 'cancelled', 'unfulfilled'].includes(req.status)

      return matchSearch && matchCategory && matchUrgency && matchActive
    })
  }, [requests, searchQuery, selectedCategory, selectedUrgency, showActiveOnly, requestScope, activeUser?.id])

  const selectedRequest = useMemo(() => {
    return requests.find((r) => r.id === selectedRequestId)
  }, [requests, selectedRequestId])

  const handleRequestScope = (scope) => {
    setRequestScope(scope)
    setShowActiveOnly(scope !== 'completed')
    setSelectedRequestId(null)
    setIsCreatingRequest(false)
  }

  // ----------------------------------------------------
  // MUTATION HANDLERS
  // ----------------------------------------------------
  
  // Suggest category/urgency via AI
  const handleAISuggest = async () => {
    if (!newRequest.title.trim() && !newRequest.description.trim()) {
      addToast('Information Needed', 'Write a title or description first so AI can analyze the keywords.', 'warning')
      return
    }

    setIsAnalyzingAI(true)
    setAiSuggestions(null)
    try {
      const response = await fetch(`${API_URL}/requests/analyze-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          title: newRequest.title,
          description: newRequest.description
        })
      })

      const json = await readJsonResponse(response)
      if (!response.ok) throw new Error(json?.error || 'AI analysis call failed')
      
      if (json.data) {
        const { category, urgency, aiSummary, isSpam } = json.data
        setAiSuggestions(json.data)
        
        if (isSpam) {
          addToast('AI Spam Alert', 'Warning: Our AI flags this content as potential spam.', 'warning')
        }

        setNewRequest((prev) => ({
          ...prev,
          category: category,
          urgency: urgency
        }))
        addToast('AI Suggestion Applied', `Category: ${CATEGORIES[category]?.label || category}, Urgency: ${urgency.toUpperCase()}`, 'success')
      }
    } catch (err) {
      console.error(err)
      addToast('AI Error', 'Failed to connect to AI agents. Check environment.', 'warning')
    } finally {
      setIsAnalyzingAI(false)
    }
  }

  // Create request
  const handleCreateRequestSubmit = async (e) => {
    e.preventDefault()
    if (isSubmittingRequest) return

    if (!newRequest.description.trim() || newRequest.description.trim().length < 10) {
      addToast('Validation', 'Description must be at least 10 characters.', 'warning')
      return
    }
    if (!newRequestLocation) {
      addToast('Coordinates Required', 'Drop a pin on the map or click GPS Detect to capture coordinates.', 'warning')
      return
    }

    setIsSubmittingRequest(true)
    try {
      const payload = {
        ...newRequest,
        location: newRequestLocation,
        aiSummary: aiSuggestions?.aiSummary || undefined
      }

      const response = await fetch(`${API_URL}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload)
      })

      const json = await readJsonResponse(response)
      if (!response.ok) throw new Error(json?.error || 'Failed to submit request')
      if (json.data) {
        addToast('Created', 'Help request published persistently to neighbors.', 'success')
        
        if (json.data.status === 'flagged') {
          addToast('AI Filter Warning', 'Your post was automatically hidden because our AI Agents flagged it as spam.', 'warning')
        }

        setIsCreatingRequest(false)
        setNewRequest({ title: '', description: '', category: 'essentials', urgency: 'normal' })
        setNewRequestLocation(null)
        setAiSuggestions(null)
        
        if (json.data.status !== 'flagged') {
          setSelectedRequestId(json.data.id)
        }
      }
    } catch (err) {
      console.error(err)
      addToast('Error', err.message || 'Failed to submit request.', 'danger')
    } finally {
      setIsSubmittingRequest(false)
    }
  }

  // Update status lifecycle
  const handleUpdateStatus = async (statusVal) => {
    if (!selectedRequestId || isUpdatingStatus) return
    
    setIsUpdatingStatus(true)
    try {
      const response = await fetch(
        `${API_URL}/requests/${selectedRequestId}${statusVal === 'accepted' ? '/accept' : '/status'}`,
        {
          method: statusVal === 'accepted' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: statusVal === 'accepted' ? undefined : JSON.stringify({ status: statusVal })
        }
      )

      const result = await readJsonResponse(response)
      if (!response.ok) throw new Error(result?.error || 'Failed to update request status.')
      if (result.data) {
        setRequests((previous) => previous.map((item) => item.id === result.data.id ? result.data : item))
        addToast('Request updated', `Status: ${result.data.status.replace('_', ' ')}.`, 'success')
      }
    } catch (err) {
      console.error(err)
      addToast('Action unavailable', err.message || 'Failed to update request status.', 'danger')
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  // Report spam
  const handleReportRequest = async () => {
    if (!selectedRequestId) return
    
    try {
      const response = await fetch(`${API_URL}/requests/${selectedRequestId}/report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      })

      const json = await readJsonResponse(response)
      if (!response.ok) throw new Error(json?.error || 'Report failed')
      
      if (json.data?.status === 'flagged') {
        addToast('Removed', 'This request has been hidden due to multiple report flags.', 'warning')
      } else {
        addToast('Report logged', 'Thank you. We have recorded your spam report.', 'info')
      }
    } catch (err) {
      console.error(err)
      addToast('Error', 'Failed to submit abuse report.', 'danger')
    }
  }

  // Handle Chat Message Sending
  const handleSendChatMessage = (e) => {
    e.preventDefault()
    if (!chatText.trim()) return

    if (socketRef.current && selectedRequest) {
      socketRef.current.emit('chat:send', {
        requestId: selectedRequest.id,
        text: chatText.trim(),
        senderId: activeUser.id,
        senderName: activeUser.name
      })
      setChatText('')
    }
  }

  // Scroll to bottom of chat log automatically
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [selectedRequest?.messages, detailTab])

  // Clear currently rendered GraphHopper route
  const clearRoute = () => {
    if (routeLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(routeLayerRef.current)
      routeLayerRef.current = null
    }
    setActiveRouteInfo(null)
  }

  // Calculate driving route using GraphHopper Routing API
  const handleCalculateRoute = async (targetRequest) => {
    if (!targetRequest?.location?.lat || !targetRequest?.location?.lng) return
    if (!GRAPHHOPPER_API_KEY) {
      addToast('GraphHopper Required', 'Set VITE_GRAPHHOPPER_API_KEY in client/.env to enable routing.', 'warning')
      return
    }

    setIsLoadingRoute(true)
    const doRoute = async (startLat, startLng) => {
      try {
        const route = await fetchRoutePolyline(startLat, startLng, targetRequest.location.lat, targetRequest.location.lng)
        if (!route) {
          addToast('Routing Failed', 'GraphHopper could not calculate a driving route to this destination.', 'warning')
          return
        }

        if (routeLayerRef.current && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(routeLayerRef.current)
          routeLayerRef.current = null
        }

        if (mapInstanceRef.current) {
          const polyline = L.polyline(route.coordinates, {
            color: '#FF4F6D',
            weight: 5,
            opacity: 0.85,
            dashArray: '8, 8'
          }).addTo(mapInstanceRef.current)
          routeLayerRef.current = polyline
          mapInstanceRef.current.fitBounds(polyline.getBounds(), { padding: [40, 40] })
        }

        setActiveRouteInfo(route)
        const km = (route.distanceMeters / 1000).toFixed(1)
        const mins = Math.max(1, Math.round(route.timeMs / 60000))
        addToast('Route Calculated', `${km} km (~${mins} mins) via GraphHopper Directions.`, 'success')
      } catch (err) {
        console.error('Route calculation error:', err)
        addToast('Routing Error', 'Failed to retrieve route from GraphHopper.', 'danger')
      } finally {
        setIsLoadingRoute(false)
      }
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => doRoute(pos.coords.latitude, pos.coords.longitude),
        () => doRoute(26.1600, 91.7650),
        { timeout: 5000 }
      )
    } else {
      doRoute(26.1600, 91.7650)
    }
  }

  // Handle manual map search (GraphHopper Geocoding with OSM fallback)
  const handleMapSearchSubmit = async () => {
    if (!mapSearchQuery.trim()) return
    setIsSearchingMap(true)
    setMapSearchResults([])
    try {
      const results = await searchGeocodeLocation(mapSearchQuery.trim())
      setMapSearchResults(results)
      if (results.length === 0) {
        addToast('No Results', 'Could not find that location on the map.', 'warning')
      }
    } catch (err) {
      console.error(err)
      addToast('Search Error', 'Failed to contact geocoding service.', 'danger')
    } finally {
      setIsSearchingMap(false)
    }
  }

  // Handle selecting a geocoding result
  const handleSelectMapSearchResult = (result) => {
    const lat = typeof result.lat === 'number' ? result.lat : parseFloat(result.lat)
    const lng = typeof result.lon === 'number' ? result.lon : parseFloat(result.lon)
    
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 15)
    }

    if (isCreatingRequest) {
      setNewRequestLocation({
        lat,
        lng,
        label: result.display_name
      })
      addToast('Pin Positioned', 'Map view centered and creation pin dropped at destination.', 'success')
    } else {
      addToast('Location Located', 'Map centered at target search coordinates.', 'info')
    }

    // Clear search states
    setMapSearchQuery('')
    setMapSearchResults([])
  }

  const setDemoLocation = (index) => {
    const locations = [
      { lat: 26.1730, lng: 91.7580, label: 'City Hospital Area, Guwahati' },
      { lat: 26.1610, lng: 91.7670, label: 'Bhangagarh Market, GS Road' },
      { lat: 26.1680, lng: 91.7820, label: 'Zoo Road Intersection' }
    ]
    setNewRequestLocation(locations[index])
  }

  return (
    <main className="min-h-screen bg-[#FFF9F5] text-slate-800 flex flex-col font-sans selection:bg-rose-100 selection:text-rose-700">
      {!currentUser ? (
        <div className="flex min-h-screen items-center justify-center px-5 py-10">
          <div className="w-full max-w-md rounded-3xl border border-rose-100 bg-white p-8 shadow-xl shadow-rose-900/5">
            <a className="mb-6 inline-flex items-center gap-2 text-2xl font-black tracking-tight text-[#FF4F6D]" href="#top">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4F6D] text-sm text-white">H</span>
              Help<span className="text-[#24324B]">Now</span>
            </a>
            <h1 className="text-2xl font-black text-[#24324B]">
              {isRestoringSession ? 'Restoring your account' : authMode === 'register' ? 'Join your community' : 'Welcome back'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">Everyone can help. Everyone can need help. We’re here for each other.</p>
            {!isRestoringSession && (
              <div className="mt-5 grid gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">What would you like to do?</p>
                {[
                  ['ask', 'Ask for Help'],
                  ['offer', 'Help Someone Nearby'],
                  ['voice', 'Talk to HelpNow AI']
                ].map(([intent, label]) => (
                  <button
                    key={intent}
                    type="button"
                    onClick={() => setAuthIntent(intent)}
                    aria-pressed={authIntent === intent}
                    className={`rounded-xl border px-4 py-2.5 text-left text-sm font-extrabold transition ${
                      authIntent === intent
                        ? 'border-[#FF4F6D] bg-[#FFE7EC] text-rose-700'
                        : 'border-rose-100 bg-[#FFF9F5] text-[#24324B] hover:border-rose-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {authIntent && (
                  <p className="text-xs text-slate-500">
                    Sign in or create an account to continue. Voice input will be available in the request form.
                  </p>
                )}
              </div>
            )}
            {isRestoringSession ? (
              <p role="status" className="mt-8 text-sm font-semibold text-rose-600">Checking your session…</p>
            ) : (
              <form className="mt-7 space-y-4" onSubmit={handleAuthSubmit}>
                {authMode === 'register' && (
                  <label className="block text-sm font-bold text-slate-700">
                    Your name
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="name"
                      value={authForm.name}
                      onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 font-medium outline-none focus:border-[#FF4F6D] focus:ring-2 focus:ring-rose-100"
                    />
                  </label>
                )}
                <label className="block text-sm font-bold text-slate-700">
                  Email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 font-medium outline-none focus:border-[#FF4F6D] focus:ring-2 focus:ring-rose-100"
                  />
                </label>
                <label className="block text-sm font-bold text-slate-700">
                  Password
                  <input
                    required
                    type="password"
                    minLength={authMode === 'register' ? 8 : undefined}
                    maxLength={128}
                    autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                    value={authForm.password}
                    onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 font-medium outline-none focus:border-[#FF4F6D] focus:ring-2 focus:ring-rose-100"
                  />
                  {authMode === 'register' && <span className="mt-1 block text-xs font-normal text-slate-500">Use at least 8 characters.</span>}
                </label>
                {authError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{authError}</p>}
                <button
                  disabled={isAuthLoading}
                  className="w-full rounded-xl bg-[#FF4F6D] px-4 py-3 font-extrabold text-white transition hover:bg-rose-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {isAuthLoading ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
                </button>
              </form>
            )}
            {!isRestoringSession && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'register' ? 'login' : 'register')
                    setAuthError('')
                  }}
                  className="mt-4 w-full text-sm font-bold text-[#FF4F6D] hover:underline"
                >
                  {authMode === 'register' ? 'Already have an account? Sign in' : 'New to HelpNow? Create an account'}
                </button>
                <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
                  HelpNow is a community network, not emergency dispatch. For immediate danger, contact your local emergency services.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
      
      {/* ----------------------------------------------------
          NAVBAR: Warm Cream & Soft Red/Rose Accent
         ---------------------------------------------------- */}
      <nav className="border-b border-[#ebdcd0]/75 bg-white/95 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <a className="text-xl font-black tracking-tight text-rose-500 hover:opacity-90 flex items-center gap-1.5" href="#top">
            <span className="flex items-center justify-center w-6 h-6 rounded bg-rose-500 text-white text-xs">H</span>
            Help<span className="text-slate-800">Now</span>
          </a>
        </div>


        <div className="flex items-center gap-3.5">
          <span className="hidden sm:block text-xs font-semibold text-slate-600">{currentUser.name}</span>
          <button
            onClick={handleSignOut}
            className="text-2xs px-3 py-1.5 rounded-md bg-white border border-[#ede7e0] text-slate-600 hover:bg-slate-50 font-bold"
          >
            Sign out
          </button>
          {/* Map visibility toggle */}
          <button
            onClick={() => setMapVisible(v => !v)}
            className="text-2xs px-3 py-1.5 rounded-md bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 font-bold transition-all"
          >
            {mapVisible ? 'Hide Map' : 'Show Map'}
          </button>
        </div>
      </nav>

      <section className="border-b border-rose-100 bg-[#FFF9F5] px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-lg font-black text-[#24324B] sm:text-xl">Everyone can help. Everyone can need help. We’re here for each other.</h1>
            <p className="mt-1 text-sm text-slate-600">Helping today never means you cannot ask for help tomorrow.</p>
            <p className="mt-1 text-xs text-slate-500">For immediate danger, contact your local emergency services. HelpNow is not emergency dispatch.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setIsCreatingRequest(true); setSelectedRequestId(null) }}
              className="rounded-xl bg-[#FF4F6D] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-rose-600"
            >
              Ask for Help
            </button>
            <button
              onClick={() => { setIsCreatingRequest(false); setSelectedRequestId(null); setRequestScope('available') }}
              className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-extrabold text-[#24324B] hover:bg-rose-50"
            >
              Help Someone Nearby
            </button>
            <button
              onClick={handleVoiceDraft}
              className="rounded-xl border border-rose-200 bg-[#FFE7EC] px-4 py-2.5 text-sm font-extrabold text-rose-700 hover:bg-rose-100"
            >
              Talk to HelpNow AI
            </button>
          </div>
        </div>
      </section>
      {socketError && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-800 sm:px-8">
          Live updates are offline. Refresh the request list after reconnecting; do not assume requests are current.
        </div>
      )}

      {/* ----------------------------------------------------
          MAIN SCREEN LAYOUT
         ---------------------------------------------------- */}
        <section className={`flex-1 grid ${mapVisible ? 'lg:grid-cols-[460px_1fr]' : 'lg:grid-cols-1'} gap-4 overflow-hidden relative min-h-[calc(100vh-69px)]`}>
          
          {/* SIDEBAR */}
          <aside className="border-r border-[#ebdcd0]/75 bg-[#fdfcfb] flex flex-col z-20 shadow-xs relative max-h-[calc(100vh-69px)] overflow-y-auto">
          
          {/* Create Request Mode Form View */}
          {isCreatingRequest ? (
            <div className="p-6 flex-1 flex flex-col animate-slide-up">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-black text-slate-850 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-rose-500" />
                    New Help Request
                  </h2>
                  <p className="text-2xs text-slate-500">Post a community request locally</p>
                </div>
                <button
                  onClick={() => {
                    setIsCreatingRequest(false)
                    setNewRequestLocation(null)
                    setAiSuggestions(null)
                  }}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateRequestSubmit} className="space-y-4 flex-1 flex flex-col">
                <div>
                  <label className="block text-3xs font-extrabold uppercase tracking-widest text-slate-500 mb-1">Request Title (Optional)</label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="e.g. Need O+ blood donor (Optional)"
                    value={newRequest.title}
                    onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })}
                    className="w-full bg-[#fdfcfb] border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 placeholder-slate-400 transition-all font-medium"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-3xs font-extrabold uppercase tracking-widest text-slate-500">Full Description & Details</label>
                    <button type="button" onClick={handleVoiceDraft} className="text-3xs font-bold text-rose-600 hover:underline">
                      Dictate draft
                    </button>
                  </div>
                  <p className="mb-1 text-[10px] text-slate-500">Browser speech recognition may process audio externally. Review the draft before publishing.</p>
                  <textarea
                    required
                    rows="3"
                    maxLength={2000}
                    placeholder="Explain what is needed, timing details, and any guidelines..."
                    value={newRequest.description}
                    onChange={(e) => setNewRequest({ ...newRequest, description: e.target.value })}
                    className="w-full bg-[#fdfcfb] border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 placeholder-slate-400 transition-all resize-none font-medium leading-relaxed"
                  />
                </div>

                {/* AI Agents Classifier Section */}
                <div className="bg-[#faf8f5] border border-[#e8ded5]/80 p-3 rounded-xl flex items-center justify-between shadow-3xs">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4.5 h-4.5 text-rose-500" />
                    <div>
                      <p className="text-2xs font-extrabold text-slate-700">AI Classifier & Summarizer</p>
                      <p className="text-4xs text-slate-500">Auto-fill category, urgency, and spam checks</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isAnalyzingAI}
                    onClick={handleAISuggest}
                    className="text-3xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all disabled:opacity-55 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isAnalyzingAI ? 'Evaluating...' : 'AI Analyze'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-3xs font-extrabold uppercase tracking-widest text-slate-500 mb-1">Category</label>
                    <select
                      value={newRequest.category}
                      onChange={(e) => setNewRequest({ ...newRequest, category: e.target.value })}
                      className="w-full bg-[#fdfcfb] border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-rose-500 transition-all font-semibold"
                    >
                      <option value="essentials">Essentials</option>
                      <option value="medical">Medical</option>
                      <option value="transport">Transport</option>
                      <option value="other">Other Support</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-3xs font-extrabold uppercase tracking-widest text-slate-500 mb-1">Urgency</label>
                    <select
                      value={newRequest.urgency}
                      onChange={(e) => setNewRequest({ ...newRequest, urgency: e.target.value })}
                      className="w-full bg-[#fdfcfb] border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-rose-500 transition-all font-bold uppercase tracking-wider text-2xs"
                    >
                      <option value="normal" className="text-sky-600">Normal</option>
                      <option value="urgent" className="text-amber-600">Urgent</option>
                      <option value="critical" className="text-rose-600">Critical</option>
                    </select>
                  </div>
                </div>

                {/* GPS Location Picker */}
                <div className="bg-[#faf8f5] border border-[#e8ded5]/80 p-3.5 rounded-xl flex-1 flex flex-col justify-center">
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-3xs font-extrabold uppercase tracking-widest text-slate-500">Approximate Location</span>
                    <button
                      type="button"
                      disabled={isLocatingGPS}
                      onClick={handleGPSDetect}
                      className="text-3xs font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Navigation className={`w-3 h-3 ${isLocatingGPS ? 'animate-spin' : ''}`} />
                      {isLocatingGPS ? 'Locating...' : 'Use GPS Location'}
                    </button>
                  </div>
                  
                  {newRequestLocation ? (
                    <div className="flex items-start gap-2.5 text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-150 shadow-3xs">
                      <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-2xs text-rose-500">Coordinates Locked</p>
                        <p className="text-4xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{newRequestLocation.label}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-3xs text-slate-500 py-1 space-y-2">
                      <p className="flex items-center gap-1 text-slate-600 font-medium">
                        <Info className="w-3.5 h-3.5 text-rose-500" />
                        Click on the map to pin your location or click "Use GPS Location" above.
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="text-4xs uppercase tracking-wider text-slate-400 font-bold w-full">Quick Demo Coordinates:</span>
                        <button type="button" onClick={() => setDemoLocation(0)} className="text-4xs bg-white border border-slate-200 hover:border-rose-300 text-slate-600 px-2 py-1 rounded shadow-3xs">City Hospital</button>
                        <button type="button" onClick={() => setDemoLocation(1)} className="text-4xs bg-white border border-slate-200 hover:border-rose-300 text-slate-600 px-2 py-1 rounded shadow-3xs">Bhangagarh</button>
                        <button type="button" onClick={() => setDemoLocation(2)} className="text-4xs bg-white border border-slate-200 hover:border-rose-300 text-slate-600 px-2 py-1 rounded shadow-3xs">Zoo Road</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmittingRequest}
                    className="w-full flex items-center justify-center gap-2 bg-rose-500 text-white font-bold py-2.5 rounded-lg hover:bg-rose-600 shadow-md shadow-rose-500/10 transition-all text-xs uppercase tracking-wider disabled:cursor-wait disabled:opacity-60"
                  >
                    {isSubmittingRequest ? 'Publishing…' : 'Publish Help Request'}
                  </button>
                </div>
              </form>
            </div>
          ) : selectedRequestId && selectedRequest ? (
            /* Request Details drawer */
            <div className="p-6 flex-1 flex flex-col animate-slide-up bg-white">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setSelectedRequestId(null)}
                  className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-rose-500 transition-colors"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  Back to feed
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={handleReportRequest}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-all flex items-center gap-1 text-3xs font-extrabold uppercase tracking-wider"
                    title="Report Spam/Abuse"
                  >
                    <Flag className="w-3 h-3" />
                    Report Spam
                  </button>
                </div>
              </div>

              {/* Badges details */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className={`px-2 py-0.5 rounded text-4xs font-bold uppercase tracking-wider border ${
                  selectedRequest.urgency === 'critical' ? 'bg-rose-50 border-rose-100 text-rose-600' :
                  selectedRequest.urgency === 'urgent' ? 'bg-amber-50 border-amber-100 text-amber-600' :
                  'bg-sky-50 border-sky-100 text-sky-600'
                }`}>
                  {selectedRequest.urgency} Urgency
                </span>
                
                <span className={`px-2 py-0.5 rounded text-4xs font-bold uppercase tracking-wider border ${
                  CATEGORIES[selectedRequest.category]?.color || 'text-slate-600 bg-slate-50 border-slate-200'
                }`}>
                  {CATEGORIES[selectedRequest.category]?.label || selectedRequest.category}
                </span>

                <span className={`ml-auto text-4xs font-mono px-2 py-0.5 rounded uppercase border font-extrabold ${
                  selectedRequest.status === 'open' ? 'bg-rose-50 border-rose-100 text-rose-500' :
                  selectedRequest.status === 'accepted' ? 'bg-indigo-50 border-indigo-100 text-indigo-500' :
                  selectedRequest.status === 'in_progress' ? 'bg-amber-50 border-amber-100 text-amber-500' :
                  'bg-slate-50 border-slate-200 text-slate-500'
                }`}>
                  {selectedRequest.status.replace('_', ' ')}
                </span>
              </div>

              <h2 className="text-lg font-black text-slate-800 leading-snug">{selectedRequest.title}</h2>
              <div className="flex items-center gap-1.5 text-3xs text-slate-500 mt-2 font-semibold">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Posted {new Date(selectedRequest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(selectedRequest.createdAt).toLocaleDateString()})</span>
              </div>

              <div className="h-px bg-slate-100 my-4" />
              {(selectedRequest.status === 'accepted' || selectedRequest.status === 'in_progress' || selectedRequest.status === 'resolved') && 
               (activeUser.id === selectedRequest.requesterId || activeUser.id === selectedRequest.helperId) && (
                <div className="flex border-b border-slate-100 mb-4 bg-slate-50/50 p-1 rounded-lg">
                  <button
                    onClick={() => setDetailTab('info')}
                    className={`flex-1 py-1.5 text-3xs font-extrabold text-center rounded-md transition-all ${
                      detailTab === 'info'
                        ? 'bg-white text-rose-500 shadow-2xs'
                        : 'text-slate-505 hover:text-slate-800'
                    }`}
                  >
                    Information & Status
                  </button>
                  <button
                    onClick={() => setDetailTab('chat')}
                    className={`flex-1 py-1.5 text-3xs font-extrabold text-center rounded-md transition-all flex items-center justify-center gap-1.5 ${
                      detailTab === 'chat'
                        ? 'bg-white text-rose-500 shadow-2xs'
                        : 'text-slate-505 hover:text-slate-800'
                    }`}
                  >
                    <span>Live Chat Session</span>
                    {selectedRequest.messages && selectedRequest.messages.length > 0 && (
                      <span className="bg-rose-500 text-white text-5xs font-black px-1.5 py-0.5 rounded-full">
                        {selectedRequest.messages.length}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {detailTab === 'info' || !(activeUser.id === selectedRequest.requesterId || activeUser.id === selectedRequest.helperId) ? (
                <div className="space-y-4 flex-1 flex flex-col min-h-0 overflow-y-auto">
                  {/* Location details */}
                  <div className="bg-[#faf8f5] border border-[#e8ded5]/65 p-3 rounded-xl flex items-start gap-2.5 shadow-3xs">
                    <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div className="text-3xs flex-1">
                      <p className="font-extrabold text-slate-700">Approximate location</p>
                      <p className="text-slate-505 mt-0.5 leading-relaxed">{selectedRequest.location?.label || 'Approximate area'}</p>
                      <p className="text-4xs text-slate-400 mt-1">The exact address is not shared with other members.</p>
                      {GRAPHHOPPER_API_KEY && (
                        <div className="mt-2.5 pt-2 border-t border-[#e8ded5]/50 flex items-center justify-between">
                          <button
                            type="button"
                            disabled={isLoadingRoute}
                            onClick={() => handleCalculateRoute(selectedRequest)}
                            className="text-4xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all disabled:opacity-50"
                          >
                            <Navigation className={`w-3 h-3 ${isLoadingRoute ? 'animate-spin' : ''}`} />
                            {isLoadingRoute ? 'Calculating route…' : activeRouteInfo ? 'Recalculate Route' : 'Show Route (GraphHopper)'}
                          </button>
                          {activeRouteInfo && (
                            <button
                              type="button"
                              onClick={clearRoute}
                              className="text-4xs font-bold text-slate-400 hover:text-slate-600"
                            >
                              Clear Route
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-3xs font-extrabold uppercase tracking-widest text-slate-500 mb-1">Request Description</h3>
                    <p className="text-xs leading-relaxed text-slate-600 bg-[#fdfcfb] p-4 rounded-xl border border-slate-150 shadow-3xs">{selectedRequest.description}</p>
                  </div>

                  {/* AI Agent summary text */}
                  {selectedRequest.aiSummary && (
                    <div className="bg-[#fffcf9] border border-rose-100/50 p-3.5 rounded-xl shadow-3xs">
                      <p className="text-3xs font-extrabold text-rose-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-rose-500" />
                        AI Helper-facing Summary
                      </p>
                      <p className="text-2xs italic text-slate-655 leading-normal">"{selectedRequest.aiSummary}"</p>
                    </div>
                  )}

                  {/* Privacy contacts */}
                  <div className="space-y-3.5">
                    <div className="bg-[#faf8f5] border border-[#e8ded5]/60 p-4 rounded-xl shadow-3xs">
                      <p className="text-3xs font-extrabold text-slate-500 uppercase tracking-widest mb-2.5">Requester Info</p>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 text-xs font-black">
                          R
                        </div>
                        <div className="text-3xs">
                          <p className="font-bold text-slate-700 text-2xs">{selectedRequest.requesterName}</p>
                        </div>
                      </div>
                    </div>

                    {selectedRequest.helperId && (
                      <div className="bg-[#faf8f5] border border-[#e8ded5]/60 p-4 rounded-xl shadow-3xs">
                        <p className="text-3xs font-extrabold text-slate-500 uppercase tracking-widest mb-2.5">Accepted Helper Details</p>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 text-xs font-black">
                            H
                          </div>
                          <div className="text-3xs">
                            <p className="font-bold text-slate-700 text-2xs">{selectedRequest.helperName}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Chat view */
                <div className="flex-1 flex flex-col min-h-0 bg-[#faf8f5] border border-[#ebdcd0]/60 rounded-xl overflow-hidden shadow-3xs mb-4">
                  {/* Chat Header with Call Action Link */}
                  <div className="bg-white border-b border-[#ebdcd0]/60 px-4 py-2.5 flex items-center justify-between shadow-3xs">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-3xs font-extrabold text-slate-700">Chat with {activeUser.id === selectedRequest.requesterId ? 'Helper' : 'Requester'}</span>
                    </div>
                    
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 p-4 space-y-3 overflow-y-auto min-h-[300px] max-h-[400px] flex flex-col">
                    {selectedRequest.messages && selectedRequest.messages.length > 0 ? (
                      selectedRequest.messages.map((msg, index) => {
                        const isSelf = msg.senderId === activeUser.id
                        return (
                          <div
                            key={index}
                            className={`max-w-[85%] p-3 rounded-xl text-xs leading-relaxed shadow-3xs flex flex-col ${
                              isSelf
                                ? 'bg-rose-500 text-white self-end rounded-br-none'
                                : 'bg-white text-slate-700 border border-slate-150 self-start rounded-bl-none'
                            }`}
                          >
                            <span className={`text-4xs font-black uppercase tracking-wider mb-0.5 ${
                              isSelf ? 'text-rose-100' : 'text-slate-400'
                            }`}>
                              {isSelf ? 'You' : msg.senderName}
                            </span>
                            <span className="font-semibold">{msg.text}</span>
                            <span className={`text-5xs font-mono mt-1 self-end ${
                              isSelf ? 'text-rose-200' : 'text-slate-350'
                            }`}>
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        )
                      })
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 py-16">
                        <MessageSquare className="w-8 h-8 text-slate-300 mb-2.5 animate-pulse" />
                        <p className="text-2xs font-extrabold text-slate-700">No messages yet</p>
                        <p className="text-4xs text-slate-400 mt-1 max-w-[200px] leading-relaxed">Send a message to coordinate coordinates or arrival.</p>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Send Input Form */}
                  <form onSubmit={handleSendChatMessage} className="border-t border-[#ebdcd0]/65 p-2 bg-white flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a message..."
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      className="flex-1 bg-[#faf8f5] border border-[#ebdcd0]/60 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-rose-500 font-semibold"
                    />
                    <button
                      type="submit"
                      className="bg-rose-500 hover:bg-rose-600 text-white font-bold px-4 py-1.5 rounded-lg text-2xs uppercase tracking-wider transition-all shadow-3xs"
                    >
                      Send
                    </button>
                  </form>
                </div>
              )}

              {/* Status lifecycle actions */}
              <div className="pt-4 mt-auto border-t border-slate-100" aria-busy={isUpdatingStatus}>
                {isUpdatingStatus && <p role="status" className="mb-2 text-center text-xs font-semibold text-slate-500">Updating request…</p>}
                {selectedRequest.status === 'open' && selectedRequest.requesterId !== activeUser.id && (
                  <button
                    onClick={() => handleUpdateStatus('accepted')}
                    disabled={isUpdatingStatus}
                    className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-2.5 rounded-lg transition-all text-xs uppercase tracking-wider shadow-sm shadow-rose-500/10"
                  >
                    Accept Request & Assist
                  </button>
                )}

                {selectedRequest.status === 'accepted' && selectedRequest.helperId === activeUser.id && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleUpdateStatus('open')}
                      disabled={isUpdatingStatus}
                      className="border border-slate-200 text-slate-500 font-bold py-2.5 rounded-lg hover:bg-slate-50 transition-all text-xs"
                    >
                      Release / Cancel
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('in_progress')}
                      disabled={isUpdatingStatus}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 rounded-lg transition-all text-xs uppercase tracking-wider"
                    >
                      Start Journey
                    </button>
                  </div>
                )}

                {selectedRequest.status === 'in_progress' && selectedRequest.helperId === activeUser.id && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleUpdateStatus('open')}
                      disabled={isUpdatingStatus}
                      className="border border-slate-200 text-slate-500 font-bold py-2.5 rounded-lg hover:bg-slate-50 transition-all text-xs"
                    >
                      I Can No Longer Help
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('resolved')}
                      disabled={isUpdatingStatus}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-lg transition-all text-xs uppercase tracking-wider"
                    >
                      Mark Complete
                    </button>
                  </div>
                )}

                {/* Cancel support for requester */}
                {selectedRequest.requesterId === activeUser.id && 
                 selectedRequest.status !== 'resolved' && 
                 selectedRequest.status !== 'cancelled' &&
                 selectedRequest.status !== 'unfulfilled' && (
                  <div className="space-y-2 mt-2">
                    {selectedRequest.status === 'in_progress' && (
                      <button
                        onClick={() => handleUpdateStatus('resolved')}
                      disabled={isUpdatingStatus}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-lg transition-all text-xs uppercase tracking-wider"
                      >
                        Mark as Resolved
                      </button>
                    )}
                    <button
                      onClick={() => handleUpdateStatus('cancelled')}
                      disabled={isUpdatingStatus}
                      className="w-full border border-rose-100 bg-rose-50/50 hover:bg-rose-50 text-rose-600 font-bold py-2 rounded-lg transition-all text-3xs uppercase tracking-widest"
                    >
                      Cancel Help Request
                    </button>
                    {selectedRequest.status === 'open' && (
                      <button
                        onClick={() => handleUpdateStatus('unfulfilled')}
                        disabled={isUpdatingStatus}
                        className="w-full border border-slate-200 bg-white py-2 text-3xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50"
                      >
                        Close: Unable to Find Help
                      </button>
                    )}
                  </div>
                )}

                {['resolved', 'cancelled', 'unfulfilled'].includes(selectedRequest.status) && (
                  <div className="text-center py-2 bg-slate-50 border border-slate-150 rounded-lg">
                    <p className="text-3xs text-slate-400 font-bold uppercase tracking-wider">
                      {selectedRequest.status === 'unfulfilled' ? 'This request was closed because no help was found.' : `This request is ${selectedRequest.status}.`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Feed List View & Search Filters */
            <>
              {/* Sidebar Header */}
              <div className="p-6 pb-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-base font-black text-slate-800">Today's Requests</h1>
                    <p className="text-3xs text-slate-400 font-semibold mt-0.5">
                      {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsCreatingRequest(true)
                      setSelectedRequestId(null)
                    }}
                    className="flex items-center gap-1 text-2xs font-extrabold text-rose-500 bg-rose-50 border border-rose-150 hover:bg-rose-100 px-3.5 py-1.5 rounded-lg transition-all shadow-3xs"
                  >
                    <Plus className="w-4.5 h-4.5 text-rose-500" />
                    Ask for Help
                  </button>
                </div>
                <p className="text-3xs text-slate-500 mt-1">Sorted by urgency, then recency. Exact distance and helper availability are not collected.</p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    ['available', 'Available Requests'],
                    ['created', 'Requests I Created'],
                    ['accepted', 'Requests I Accepted'],
                    ['completed', 'Completed Assistance']
                  ].map(([scope, label]) => (
                    <button
                      key={scope}
                      onClick={() => handleRequestScope(scope)}
                      aria-pressed={requestScope === scope}
                      className={`rounded-lg border px-2 py-2 text-left text-[11px] font-bold transition ${
                        requestScope === scope
                          ? 'border-rose-300 bg-rose-50 text-rose-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search & Filters */}
              <div className="px-6 pb-4 border-b border-[#ebdcd0]/60 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search requests..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-[#eae3da] rounded-lg pl-9 pr-4 py-2 text-xs text-slate-800 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/15 placeholder-slate-400 font-medium transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-655"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Categories */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`text-3xs font-extrabold px-2.5 py-1 rounded transition-all border ${
                      selectedCategory === 'all'
                        ? 'bg-rose-500 text-white border-rose-400 shadow-3xs'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    All Needs
                  </button>
                  {Object.entries(CATEGORIES).map(([key, item]) => (
                    <button
                      key={key}
                      onClick={() => setSelectedCategory(key)}
                      className={`text-3xs font-extrabold px-2.5 py-1 rounded transition-all border ${
                        selectedCategory === key
                          ? 'bg-rose-500 text-white border-rose-400 shadow-3xs'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {item.label.split(' ')[0]}
                    </button>
                  ))}
                </div>

                {/* Urgencies and Checkboxes */}
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                  <div className="flex gap-1.5">
                    {['all', 'critical', 'urgent', 'normal'].map((urg) => (
                      <button
                        key={urg}
                        onClick={() => setSelectedUrgency(urg)}
                        className={`text-4xs uppercase tracking-wider font-extrabold px-2 py-0.5 rounded border ${
                          selectedUrgency === urg
                            ? urg === 'critical' ? 'bg-rose-5 border-rose-200 text-rose-600' :
                              urg === 'urgent' ? 'bg-amber-5 border-amber-200 text-amber-600' :
                              urg === 'normal' ? 'bg-sky-5 border-sky-200 text-sky-600' :
                              'bg-slate-800 border-slate-700 text-white'
                            : 'bg-white text-slate-400 border-slate-150 hover:border-slate-200'
                        }`}
                      >
                        {urg}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showActiveOnly}
                      onChange={(e) => setShowActiveOnly(e.target.checked)}
                      className="w-3.5 h-3.5 accent-rose-500 rounded cursor-pointer border-slate-350"
                    />
                    <span className="text-3xs text-slate-500 font-bold uppercase tracking-wider">Active Only</span>
                  </label>
                </div>
              </div>

              {/* List Feed */}
              <div className="flex-1 divide-y divide-[#f5efe9] overflow-y-auto bg-[#fffcf9]/30">
                {isLoadingRequests ? (
                  <div role="status" className="p-8 text-center text-sm font-semibold text-slate-500">Loading community requests…</div>
                ) : requestLoadError ? (
                  <div role="alert" className="p-8 text-center">
                    <p className="text-sm font-bold text-rose-700">Could not load requests</p>
                    <p className="mt-1 text-xs text-slate-500">{requestLoadError}</p>
                    <button
                      onClick={() => setRequestReloadKey((value) => value + 1)}
                      className="mt-3 rounded-lg bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-600"
                    >
                      Try again
                    </button>
                  </div>
                ) : filteredRequests.length > 0 ? (
                  filteredRequests.map((request) => {
                    const isSelected = request.id === selectedRequestId
                    const categoryInfo = CATEGORIES[request.category]
                    const formattedTime = new Date(request.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                    return (
                      <article
                        key={request.id}
                        onClick={() => setSelectedRequestId(request.id)}
                        className={`p-5 text-left cursor-pointer transition-all border-l-3 relative ${
                          isSelected
                            ? 'bg-rose-50/20 border-l-rose-500'
                            : request.urgency === 'critical' && request.status === 'open'
                            ? 'border-l-rose-500 bg-rose-50/10 hover:bg-slate-50'
                            : 'border-l-transparent hover:bg-slate-50/65'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2.5 mb-2">
                          <span className={`text-4xs font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${
                            categoryInfo?.color || 'text-slate-505 bg-slate-50 border-slate-200'
                          }`}>
                            {categoryInfo?.label || request.category}
                          </span>

                          <div className="flex items-center gap-2">
                            {request.status !== 'open' && (
                              <span className="text-4xs font-mono font-bold uppercase tracking-widest text-slate-400">
                                {request.status.replace('_', ' ')}
                              </span>
                            )}
                            
                            <span className={`px-2 py-0.5 rounded text-4xs font-extrabold uppercase tracking-wider font-mono ${
                              request.urgency === 'critical' ? 'bg-rose-50 text-rose-500 border border-rose-100' :
                              request.urgency === 'urgent' ? 'bg-amber-50 text-amber-505 border border-amber-100' :
                              'bg-sky-50 text-sky-505 border border-sky-100'
                            }`}>
                              {request.urgency}
                            </span>
                          </div>
                        </div>

                        <h2 className="font-bold text-xs text-slate-800 hover:text-rose-500 transition-colors line-clamp-1">{request.title}</h2>
                        <p className="text-3xs text-slate-550 mt-1 line-clamp-2 leading-relaxed font-medium">{request.description}</p>
                        
                        <div className="flex items-center justify-between mt-3 text-4xs text-slate-450 font-bold uppercase tracking-wider">
                          <span className="flex items-center gap-1 text-slate-500 truncate max-w-[210px] font-semibold">
                            <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            {request.location?.label.split(', ')[0] || 'Guwahati'}
                          </span>
                          <span className="shrink-0 font-mono text-slate-400">{formattedTime}</span>
                        </div>
                      </article>
                    )
                  })
                ) : (
                  <div className="p-8 text-center text-slate-450 py-16">
                    <Info className="w-7 h-7 mx-auto text-slate-350 mb-2.5" />
                    <p className="text-xs font-bold text-slate-500">
                      {requestScope === 'available' ? 'No open requests right now' :
                        requestScope === 'created' ? 'You have not created a request yet' :
                          requestScope === 'accepted' ? 'You have not accepted a request' : 'No completed assistance yet'}
                    </p>
                    <p className="text-3xs text-slate-400 mt-1">
                      {requestScope === 'available' ? 'Check back later or post a request if you need help.' : 'Switch sections at any time to ask for or offer community help.'}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        {/* MAP CONTAINER */}
        {mapVisible && (
          <div className="w-full h-full relative z-10 p-2">
            <div id="map-container" ref={mapRef} className="w-full h-full min-h-[400px] lg:min-h-0 bg-[#f7f4ee]" />
            
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md border border-[#ebdcd0]/75 px-3 py-2 rounded-lg z-20 shadow-sm pointer-events-none">
              <p className="text-3xs font-extrabold text-rose-500 flex items-center gap-1.5 uppercase tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                Neighborhood Help Map
              </p>
              <p className="text-4xs text-slate-500 font-mono mt-0.5">
                {GRAPHHOPPER_API_KEY ? 'GraphHopper Engine · Leaflet' : 'Leaflet OSM Light · Positron'}
              </p>
            </div>

            {/* Active GraphHopper Route Banner on Map */}
            {activeRouteInfo && (
              <div className="absolute bottom-6 left-4 bg-white/95 backdrop-blur-md border border-rose-200 px-3.5 py-2.5 rounded-xl z-20 shadow-md flex items-center gap-3 animate-slide-up">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
                <div>
                  <p className="text-2xs font-extrabold text-slate-800">
                    Route: {(activeRouteInfo.distanceMeters / 1000).toFixed(1)} km · ~{Math.max(1, Math.round(activeRouteInfo.timeMs / 60000))} min drive
                  </p>
                  <p className="text-5xs text-rose-500 font-bold uppercase tracking-wider">Directions by GraphHopper</p>
                </div>
                <button
                  type="button"
                  onClick={clearRoute}
                  className="ml-2 text-3xs font-bold text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                  title="Clear route"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

          {/* Floating Address Search Panel (inside map area) */}
          {mapVisible && (
            <div className="absolute top-4 right-4 z-20 w-80 flex flex-col gap-2">
              <div className="bg-white/95 backdrop-blur-md border border-[#ebdcd0]/75 p-2 rounded-xl shadow-md flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search address or area..."
                      value={mapSearchQuery}
                      onChange={(e) => setMapSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleMapSearchSubmit()
                        }
                      }}
                      className="w-full bg-[#faf8f5] border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:border-rose-500 font-semibold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleMapSearchSubmit}
                    disabled={isSearchingMap}
                    className="bg-rose-500 hover:bg-rose-600 text-white font-bold px-3 py-1.5 rounded-lg text-3xs uppercase tracking-wider transition-all disabled:opacity-50"
                  >
                    {isSearchingMap ? '...' : 'Search'}
                  </button>
                </div>

                {/* Search Results Dropdown */}
                {mapSearchResults.length > 0 && (
                  <div className="bg-white border border-[#ebdcd0]/60 rounded-lg overflow-hidden max-h-48 overflow-y-auto divide-y divide-slate-100 shadow-lg">
                    {mapSearchResults.map((result, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectMapSearchResult(result)}
                        className="w-full text-left p-2 hover:bg-[#faf8f5] transition-colors text-4xs font-medium text-slate-700 block line-clamp-2 leading-relaxed"
                      >
                        📍 {result.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isCreatingRequest && (
                <div className="bg-rose-500 text-white border border-rose-400 px-4 py-2 rounded-lg shadow-md font-bold text-xs flex items-center gap-2 animate-pulse">
                  <MapPin className="w-4 h-4 text-white animate-bounce shrink-0" />
                  <span>Search location or click on map to lock coordinates</span>
                </div>
              )}
            </div>
          )}
      </section>
        </>
      )}

      {/* TOASTS */}
      <div className="fixed bottom-6 right-6 space-y-2.5 z-55 max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-xl shadow-lg border flex items-start gap-3 transition-all duration-300 animate-slide-up bg-white ${
              toast.type === 'success' ? 'border-emerald-200 text-emerald-600 bg-emerald-50/30' :
              toast.type === 'danger' ? 'border-rose-200 text-rose-600 bg-rose-50/30' :
              toast.type === 'warning' ? 'border-amber-200 text-amber-600 bg-amber-50/30' :
              'border-[#ebdcd0] text-slate-700'
            }`}
          >
            <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${
              toast.type === 'success' ? 'text-emerald-500' :
              toast.type === 'danger' ? 'text-rose-500' :
              toast.type === 'warning' ? 'text-amber-500' :
              'text-rose-500'
            }`} />
            <div className="text-xs font-semibold">
              <p className="font-extrabold text-slate-800">{toast.title}</p>
              <p className="text-slate-555 mt-1 font-medium leading-relaxed">{toast.message}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
