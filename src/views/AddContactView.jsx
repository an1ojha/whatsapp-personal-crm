import { useState } from 'react'
import { useContacts } from '../hooks/useContacts.jsx'
import { useSettings } from '../hooks/useSettings.jsx'
import { compressImage } from '../utils/imageUtils.js'
import { extractContactFromImage } from '../hooks/useVisionAPI.js'
import ContactForm from '../components/contact/ContactForm.jsx'

// Steps: 'pick' | 'extracting' | 'form'

export default function AddContactView({ onClose }) {
  const { dispatch } = useContacts()
  const { settings } = useSettings()
  const [step, setStep] = useState('pick')
  const [photoDataUrl, setPhotoDataUrl] = useState(null)
  const [extracted, setExtracted] = useState({})
  const [extractError, setExtractError] = useState(null)
  const [visible, setVisible] = useState(true)

  function close() {
    setVisible(false)
    setTimeout(onClose, 300)
  }

  async function handleFilePick(file) {
    if (!file) return
    const dataUrl = await compressImage(file)
    setPhotoDataUrl(dataUrl)

    if (!settings.openaiApiKey) {
      setExtractError('No API key set — fill in details manually.')
      setExtracted({})
      setStep('form')
      return
    }

    setStep('extracting')
    try {
      const result = await extractContactFromImage(dataUrl, settings.openaiApiKey)
      setExtracted(result)
      setExtractError(null)
    } catch (err) {
      setExtractError(`Couldn't read the image (${err.message}). Fill in details manually.`)
      setExtracted({})
    }
    setStep('form')
  }

  function handleSave(formData) {
    const contact = {
      id: crypto.randomUUID(),
      photo: photoDataUrl,
      ...formData,
      status: 'new',
      lastCaughtUp: null,
      addedAt: new Date().toISOString(),
      deferredUntil: null,
    }
    dispatch({ type: 'ADD_CONTACT', payload: contact })
    close()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          maxHeight: '95vh',
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
          boxShadow: 'var(--shadow-sheet)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-6) var(--space-2)',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            {step === 'pick' && 'Add Contact'}
            {step === 'extracting' && 'Reading screenshot...'}
            {step === 'form' && 'Contact Details'}
          </h2>
          <button
            onClick={close}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="scroll-container" style={{ flex: 1, overflow: 'auto', padding: '0 var(--space-6) var(--space-4)' }}>
          {step === 'pick' && (
            <PickStep onFilePick={handleFilePick} />
          )}
          {step === 'extracting' && (
            <ExtractingStep photoDataUrl={photoDataUrl} />
          )}
          {step === 'form' && (
            <>
              {extractError && (
                <div style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--accent-warning-dim)',
                  border: '1px solid rgba(251,191,36,0.2)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  color: 'var(--accent-warning)',
                  marginBottom: 'var(--space-5)',
                  lineHeight: 1.5,
                }}>
                  ⚠️ {extractError}
                </div>
              )}

              {/* Photo preview */}
              {photoDataUrl && (
                <div style={{
                  marginBottom: 'var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  height: 120,
                  position: 'relative',
                }}>
                  <img
                    src={photoDataUrl}
                    alt="Screenshot"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    padding: 'var(--space-2) var(--space-3)',
                  }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                      WhatsApp screenshot
                    </span>
                  </div>
                </div>
              )}

              <ContactForm
                initialData={extracted}
                onSave={handleSave}
                onCancel={close}
                submitLabel="Add to Loop"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PickStep({ onFilePick }) {
  const inputId = 'photo-pick-input'

  return (
    <div style={{ padding: 'var(--space-4) 0 var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
        Pick a WhatsApp contact screenshot from your gallery. GPT-4o Vision will automatically extract the contact's name, phone number, and company.
      </p>

      <label
        htmlFor={inputId}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-10)',
          borderRadius: 'var(--radius-xl)',
          border: '2px dashed rgba(167, 139, 250, 0.4)',
          background: 'var(--accent-primary-dim)',
          cursor: 'pointer',
          transition: 'border-color 0.15s ease',
          minHeight: 200,
        }}
      >
        <span style={{ fontSize: 52 }}>📱</span>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 6 }}>
            Pick a Screenshot
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            WhatsApp contact or profile screenshot
          </p>
        </div>
      </label>

      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={e => onFilePick(e.target.files?.[0])}
        style={{ display: 'none' }}
      />

      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        color: 'var(--text-tertiary)',
        lineHeight: 1.6,
      }}>
        🔒 Your screenshot is processed by OpenAI GPT-4o and never stored on any server. Everything stays on your device.
      </div>
    </div>
  )
}

function ExtractingStep({ photoDataUrl }) {
  return (
    <div style={{
      padding: 'var(--space-8) 0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-6)',
    }}>
      {photoDataUrl && (
        <div style={{
          width: 120,
          height: 120,
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <img src={photoDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Spinner />
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p style={{ fontSize: 16, fontWeight: 600 }}>Reading screenshot...</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          GPT-4o Vision is extracting contact details
        </p>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{
      width: 32,
      height: 32,
      borderRadius: '50%',
      border: '3px solid rgba(167, 139, 250, 0.2)',
      borderTopColor: 'var(--accent-primary)',
      animation: 'spin 0.8s linear infinite',
    }} />
  )
}
