import { useState } from 'react'
import { SUGGESTED_CATEGORIES } from '../../constants/categories.js'

export default function ContactForm({ initialData = {}, onSave, onCancel, submitLabel = 'Save' }) {
  // catchupMode is now an array: [], ['in-person'], ['virtual'], ['in-person','virtual']
  const normalizeModes = (raw) => {
    if (Array.isArray(raw)) return raw
    if (raw === 'in-person' || raw === 'virtual') return [raw]
    return []
  }

  const [form, setForm] = useState({
    name: initialData.name || '',
    phone: initialData.phone || '',
    company: initialData.company || '',
    category: initialData.category || '',
    catchupModes: normalizeModes(initialData.catchupMode ?? initialData.catchupModes),
    frequency: initialData.frequency ? String(initialData.frequency) : '',
    urgentPurpose: initialData.urgentPurpose || '',
    notes: initialData.notes || '',
  })
  const [errors, setErrors] = useState({})

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  function toggleMode(mode) {
    setForm(f => ({
      ...f,
      catchupModes: f.catchupModes.includes(mode)
        ? f.catchupModes.filter(m => m !== mode)
        : [...f.catchupModes, mode],
    }))
    setErrors(e => ({ ...e, catchupModes: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (form.catchupModes.length === 0) errs.catchupModes = 'Select at least one mode'
    const freq = parseInt(form.frequency)
    if (!form.frequency || isNaN(freq) || freq < 1) errs.frequency = 'Enter a valid number of days'
    return errs
  }

  function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    onSave({
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      category: form.category.trim(),
      catchupMode: form.catchupModes.join(','), // stored as comma-sep for backwards compat
      catchupModes: form.catchupModes,
      frequency: parseInt(form.frequency),
      urgentPurpose: form.urgentPurpose.trim(),
      notes: form.notes.trim(),
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Name */}
      <Field label="Name" error={errors.name} required>
        <input
          className="input-base"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Full name"
          autoFocus
        />
      </Field>

      {/* Phone */}
      <Field label="Phone">
        <input
          className="input-base"
          type="tel"
          value={form.phone}
          onChange={e => set('phone', e.target.value)}
          placeholder="+1 234 567 8900"
        />
      </Field>

      {/* Company */}
      <Field label="Company / Role">
        <input
          className="input-base"
          value={form.company}
          onChange={e => set('company', e.target.value)}
          placeholder="Company or job title"
        />
      </Field>

      {/* Category */}
      <Field label="Category">
        <input
          className="input-base"
          value={form.category}
          onChange={e => set('category', e.target.value)}
          placeholder="e.g. Investor, Customer..."
          style={{ marginBottom: 'var(--space-2)' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {SUGGESTED_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => set('category', cat)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-full)',
                fontSize: 13,
                fontWeight: 500,
                background: form.category === cat ? 'var(--accent-primary-dim)' : 'var(--bg-elevated)',
                color: form.category === cat ? 'var(--accent-primary)' : 'var(--text-secondary)',
                border: `1px solid ${form.category === cat ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                transition: 'all 0.15s ease',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </Field>

      {/* Catchup Mode — multi-select */}
      <Field label="Catchup Mode" error={errors.catchupModes} required>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {[
            { id: 'in-person', label: '🤝 In Person' },
            { id: 'virtual',   label: '💻 Virtual'   },
          ].map(({ id, label }) => {
            const active = form.catchupModes.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleMode(id)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                  fontWeight: 600,
                  background: active ? 'var(--accent-primary-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
              >
                {label}
                {active && (
                  <span style={{
                    position: 'absolute',
                    top: 6, right: 8,
                    fontSize: 10,
                    color: 'var(--accent-primary)',
                    fontWeight: 800,
                  }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Select all that apply — you can catch up either way
        </p>
      </Field>

      {/* Frequency */}
      <Field label="Ideal frequency (days)" error={errors.frequency} required>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input
            className="input-base"
            type="number"
            min="1"
            max="365"
            value={form.frequency}
            onChange={e => set('frequency', e.target.value)}
            placeholder="14"
            style={{ flex: 1 }}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: 14, whiteSpace: 'nowrap' }}>
            days
          </span>
        </div>
        {/* Quick presets */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          {[7, 14, 30, 60, 90].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => set('frequency', String(n))}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                fontSize: 12,
                fontWeight: 500,
                background: form.frequency === String(n) ? 'var(--accent-primary-dim)' : 'var(--bg-elevated)',
                color: form.frequency === String(n) ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                border: `1px solid ${form.frequency === String(n) ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
              }}
            >
              {n}d
            </button>
          ))}
        </div>
      </Field>

      {/* Urgent Purpose */}
      <Field label="Urgent purpose (optional)">
        <input
          className="input-base"
          value={form.urgentPurpose}
          onChange={e => set('urgentPurpose', e.target.value)}
          placeholder="e.g. Discuss Series A terms"
        />
      </Field>

      {/* Notes */}
      <Field label="Notes (optional)">
        <textarea
          className="input-base"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Any context or reminders..."
          rows={3}
          style={{ resize: 'none', lineHeight: 1.5 }}
        />
      </Field>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', paddingBottom: 'var(--space-8)' }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 15,
              fontWeight: 600,
              border: '1px solid var(--border-default)',
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          style={{
            flex: 2,
            padding: '14px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(124, 58, 237, 0.4)',
          }}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, error, required }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {label}{required && <span style={{ color: 'var(--accent-danger)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent-danger)' }}>{error}</p>
      )}
    </div>
  )
}
