import { reactive } from 'vue'
import * as tus from 'tus-js-client'

// Single-request uploads (upload() below — in-browser recordings and mashups)
// must fit nginx client_max_body_size for the API (nginx/nginx.ec2.conf).
// A little headroom is left for the other multipart form fields.
export const MAX_UPLOAD_MB = 100
const MAX_UPLOAD_BYTES = (MAX_UPLOAD_MB - 1) * 1024 * 1024

// Picked files go through the resumable upload instead (uploadResumable()).
// Must match MAX_SESSION_UPLOAD_BYTES in backend/utilities/sessionUploads.js.
export const MAX_RESUMABLE_UPLOAD_LABEL = '1.2 GB'
const MAX_RESUMABLE_UPLOAD_BYTES = Math.round(1.2 * 1024 ** 3)
const CHUNK_SIZE = 10 * 1024 * 1024 // well under nginx's 100 MB request limit
// Retry a dropped piece for ~10 minutes before giving up
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000]

// Recording dates must fall between MIN_RECORDED_DATE and today (the server
// checks the same range, see validateRecordedAt in backend/utilities/sessionRecords.js).
// Catches a year typed as "26", which ends up stored as the year 0026.
export const MIN_RECORDED_DATE = '1950-01-01'
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** A message explaining what's wrong with a recording date, or null if it's fine (or empty). */
export function recordedDateError(value) {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'The recording date is not a valid date.'
  if (value < MIN_RECORDED_DATE) return `The recording date (${value}) is before ${MIN_RECORDED_DATE.slice(0, 4)}. Please check the year.`
  if (value > todayISO()) return `The recording date (${value}) is in the future. Please check the date.`
  return null
}

function tooLargeMessage(size, limitLabel = `${MAX_UPLOAD_MB} MB`) {
  const mb = Math.round(size / (1024 * 1024))
  return `This file is ${mb.toLocaleString()} MB, which is over the ${limitLabel} upload limit. ` +
    'Try exporting it as an MP3 or another compressed format, or split it into shorter recordings.'
}

const state = reactive({
  sessions: [],
  loaded: false,
  // Resumable uploads the server is still processing (or that failed)
  processing: []
})

let pollTimer = null

export const sessions = {
  get list() { return state.sessions },

  async load() {
    if (state.loaded) return
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        state.sessions = data.sessions
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      state.loaded = true
    }
  },

  async upload(file, name, recordedAt, bandId, sessionType, instrumentId) {
    const dateError = recordedDateError(recordedAt)
    if (dateError) throw new Error(dateError)
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(tooLargeMessage(file.size))
    }

    const formData = new FormData()
    formData.append('audio', file)
    formData.append('name', name)
    if (recordedAt) formData.append('recorded_at', recordedAt)
    if (bandId) formData.append('band_id', bandId)
    if (sessionType) formData.append('session_type', sessionType)
    if (instrumentId) formData.append('instrument_id', instrumentId)

    const res = await fetch('/api/sessions', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      // Errors can come from nginx as an HTML page (e.g. 413 when the body is
      // over client_max_body_size), so don't assume the body is JSON.
      let err = {}
      try { err = await res.json() } catch { /* non-JSON error page */ }
      let message = err.message
      if (!message) {
        if (res.status === 413) message = tooLargeMessage(file.size)
        else if (res.status === 502 || res.status === 503 || res.status === 504) {
          message = 'The server did not respond in time. Please try again in a moment.'
        } else message = `Upload failed (error ${res.status}).`
      }
      const error = new Error(message)
      if (err.requiresSubscription) error.requiresSubscription = true
      throw error
    }

    const data = await res.json()
    state.sessions.unshift(data.session)
    return data.session
  },

  async update(id, patch) {
    const dateError = recordedDateError(patch.recorded_at)
    if (dateError) throw new Error(dateError)
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })

    if (!res.ok) {
      let message = 'Update failed'
      try { message = (await res.json()).message || message } catch { /* not JSON */ }
      throw new Error(message)
    }

    const data = await res.json()
    const idx = state.sessions.findIndex(s => s.id === id)
    if (idx !== -1) state.sessions[idx] = data.session
  },

  async rate(id, rating) {
    const res = await fetch(`/api/sessions/${id}/rate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating })
    })
    if (!res.ok) throw new Error('Rating failed')
    const data = await res.json()
    const idx = state.sessions.findIndex(s => s.id === id)
    if (idx !== -1) {
      state.sessions[idx] = { ...state.sessions[idx], ...data }
    }
  },

  async remove(id) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Delete failed')
    state.sessions = state.sessions.filter(s => s.id !== id)
  },

  reset() {
    state.sessions = []
    state.loaded = false
    state.processing = []
    clearTimeout(pollTimer)
    pollTimer = null
  },

  get processing() { return state.processing },

  /**
   * Upload a picked file in resumable pieces (tus). Survives dropped
   * connections; if the same file was partly uploaded earlier (same name,
   * band, etc.) it continues from where it stopped.
   *
   * @returns {{ promise: Promise<void>, abort: () => void }} — the promise
   *   resolves once the whole file has reached the server; the server then
   *   processes it in the background (see `processing`).
   */
  uploadResumable(file, { name, recordedAt, bandId, sessionType, instrumentId }, { onProgress, onRetrying } = {}) {
    const dateError = recordedDateError(recordedAt)
    if (dateError) return { promise: Promise.reject(new Error(dateError)), abort() {} }
    if (file.size > MAX_RESUMABLE_UPLOAD_BYTES) {
      return { promise: Promise.reject(new Error(tooLargeMessage(file.size, MAX_RESUMABLE_UPLOAD_LABEL))), abort() {} }
    }

    const metadata = {
      filename: file.name,
      filetype: file.type || '',
      name: name || '',
      session_type: sessionType || 'band'
    }
    if (recordedAt) metadata.recorded_at = recordedAt
    if (bandId) metadata.band_id = String(bandId)
    if (instrumentId) metadata.instrument_id = String(instrumentId)

    let upload, rejectUpload
    const promise = new Promise((resolve, reject) => {
      rejectUpload = reject
      upload = new tus.Upload(file, {
        endpoint: '/api/sessions/uploads',
        chunkSize: CHUNK_SIZE,
        retryDelays: RETRY_DELAYS,
        metadata,
        removeFingerprintOnSuccess: true,
        onBeforeRequest(req) { req.getUnderlyingObject().withCredentials = true },
        onProgress(sent, total) { onProgress?.(sent, total) },
        onShouldRetry(err, retryAttempt, options) {
          const status = err.originalResponse ? err.originalResponse.getStatus() : 0
          // Don't retry requests the server rejected on purpose (limits, auth, bad file)
          if (status >= 400 && status < 500 && status !== 409 && status !== 423) return false
          if (status === 507) return false // server low on storage
          onRetrying?.(retryAttempt)
          return true
        },
        onChunkComplete() { onRetrying?.(null) },
        onError(err) { reject(toUploadError(err, file)) },
        onSuccess() { resolve() }
      })

      // Continue an earlier partial upload of this same file with the same details
      upload.findPreviousUploads().then(previous => {
        const match = previous
          .filter(p => JSON.stringify(p.metadata) === JSON.stringify(metadata))
          .sort((a, b) => new Date(b.creationTime) - new Date(a.creationTime))[0]
        if (match) upload.resumeFromPreviousUpload(match)
        upload.start()
      }).catch(() => upload.start())
    })

    promise.then(() => this.pollProcessing(), () => {})
    // Stop without deleting what the server already has, so picking the same
    // file again with the same details continues where it stopped.
    const abort = () => {
      upload?.abort()
      rejectUpload(new Error('Upload stopped. Pick the same file again with the same details to continue where it stopped.'))
    }
    return { promise, abort }
  },

  /** Refresh `processing`; keeps polling while anything is still being processed. */
  async pollProcessing() {
    clearTimeout(pollTimer)
    pollTimer = null
    try {
      const res = await fetch('/api/sessions/processing', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      const pending = []
      for (const job of data.uploads) {
        if (job.status === 'ready') {
          if (job.session && !state.sessions.some(s => s.id === job.session.id)) {
            state.sessions.unshift(job.session)
          }
          this.dismissProcessing(job.uploadId)
        } else {
          pending.push(job)
        }
      }
      state.processing = pending
    } catch (err) {
      console.error('Failed to check processing uploads:', err)
    }
    if (state.processing.some(j => j.status === 'queued' || j.status === 'processing')) {
      pollTimer = setTimeout(() => this.pollProcessing(), 5000)
    }
  },

  async dismissProcessing(uploadId) {
    state.processing = state.processing.filter(j => j.uploadId !== uploadId)
    try {
      await fetch(`/api/sessions/processing/${encodeURIComponent(uploadId)}`, { method: 'DELETE', credentials: 'include' })
    } catch { /* best effort */ }
  }
}

// Turn a tus-js-client error into one with a readable message
// (and requiresSubscription for the paywall).
function toUploadError(err, file) {
  const res = err.originalResponse
  if (!res) return new Error('Upload failed: the connection to the server was lost. Pick the same file and upload again to continue where it stopped.')
  const status = res.getStatus()
  let body = {}
  try { body = JSON.parse(res.getBody()) } catch { /* not JSON */ }
  let message = body.message
  if (!message) {
    if (status === 413) message = tooLargeMessage(file.size, MAX_RESUMABLE_UPLOAD_LABEL)
    else if (status === 401) message = 'Your login has expired. Please log in again and retry the upload.'
    else message = `Upload failed (error ${status}).`
  }
  const error = new Error(message)
  if (body.requiresSubscription) error.requiresSubscription = true
  return error
}
