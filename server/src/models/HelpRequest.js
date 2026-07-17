import mongoose from 'mongoose'

const HelpRequestSchema = new mongoose.Schema(
  {
    requesterId: {
      type: String,
      required: true,
      index: true
    },
    requesterName: {
      type: String,
      required: true
    },
    requesterPhone: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      required: true,
      enum: ['medical', 'transport', 'essentials', 'other'],
      lowercase: true
    },
    urgency: {
      type: String,
      required: true,
      enum: ['normal', 'urgent', 'critical'],
      lowercase: true
    },
    status: {
      type: String,
      required: true,
      enum: ['open', 'accepted', 'in_progress', 'resolved', 'cancelled', 'flagged'],
      default: 'open',
      index: true
    },
    location: {
      lat: {
        type: Number,
        required: true
      },
      lng: {
        type: Number,
        required: true
      },
      label: {
        type: String,
        required: true,
        trim: true
      }
    },
    reports: {
      type: Number,
      default: 0
    },
    aiSummary: {
      type: String,
      trim: true
    },
    helperId: {
      type: String,
      default: null,
      index: true
    },
    helperName: {
      type: String,
      default: null
    },
    helperPhone: {
      type: String,
      default: null
    },
    acceptedAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    messages: [
      {
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
      }
    ]
  },
  {
    timestamps: true
  }
)

// Index for geospatial queries
HelpRequestSchema.index({ 'location.lat': 1, 'location.lng': 1 })

export const HelpRequest = mongoose.model('HelpRequest', HelpRequestSchema)
