import { useReducer, useEffect, useState } from 'react'
import { getLinkedInEnrichments, setLinkedInEnrichments } from '../utils/storage.js'

// Module-level cache so the JSON is only fetched once per session
let cachedProfiles = null
let fetchPromise = null

function reducer(state, action) {
  switch (action.type) {
    case 'SUBMIT_ENRICHMENT': {
      const { url, data } = action
      const reviewedUrls = state.reviewedUrls.includes(url)
        ? state.reviewedUrls
        : [...state.reviewedUrls, url]
      return {
        reviewedUrls,
        enrichments: {
          ...state.enrichments,
          [url]: { ...data, linkedinUrl: url, reviewedAt: new Date().toISOString(), skipped: false },
        },
      }
    }
    case 'SKIP_PROFILE': {
      const { url } = action
      const reviewedUrls = state.reviewedUrls.includes(url)
        ? state.reviewedUrls
        : [...state.reviewedUrls, url]
      return {
        reviewedUrls,
        enrichments: {
          ...state.enrichments,
          [url]: { linkedinUrl: url, reviewedAt: new Date().toISOString(), skipped: true,
            relationshipNote: '', interactionModes: [], nextTalkReason: '', nextTalkTiming: null },
        },
      }
    }
    case 'RESET_ALL':
      return { reviewedUrls: [], enrichments: {} }
    default:
      return state
  }
}

export function useLinkedInEnrichments() {
  const [state, dispatch] = useReducer(reducer, null, getLinkedInEnrichments)
  const [isLoading, setIsLoading] = useState(!cachedProfiles)
  const [fetchError, setFetchError] = useState(null)

  // Persist to localStorage whenever state changes
  useEffect(() => {
    setLinkedInEnrichments(state)
  }, [state])

  // Fetch profiles once
  useEffect(() => {
    if (cachedProfiles) {
      setIsLoading(false)
      return
    }
    if (!fetchPromise) {
      fetchPromise = fetch('/linkedin_data/ranked_connections.json')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(data => { cachedProfiles = data })
        .catch(err => { fetchPromise = null; throw err })
    }
    fetchPromise
      .then(() => setIsLoading(false))
      .catch(err => { setFetchError(err.message); setIsLoading(false) })
  }, [])

  const profiles = cachedProfiles || []
  const reviewedSet = new Set(state.reviewedUrls)

  return {
    profiles,
    isLoading,
    fetchError,
    totalCount: profiles.length,
    reviewedCount: state.reviewedUrls.length,
    isDone: profiles.length > 0 && state.reviewedUrls.length >= profiles.length,
    isReviewed: url => reviewedSet.has(url),
    getEnrichment: url => state.enrichments[url] || null,
    getAllEnrichments: () => ({ profiles, enrichments: state.enrichments }),
    submitEnrichment: (url, data) => dispatch({ type: 'SUBMIT_ENRICHMENT', url, data }),
    skipProfile: url => dispatch({ type: 'SKIP_PROFILE', url }),
    resetAll: () => dispatch({ type: 'RESET_ALL' }),
  }
}
