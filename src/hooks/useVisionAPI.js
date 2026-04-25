const EXTRACTION_PROMPT = `You are a contact extraction assistant. This image is a WhatsApp contact screenshot or profile screen. Extract the contact details and respond ONLY with a JSON object in this exact format:

{
  "name": "full name or empty string if not found",
  "phone": "phone number with country code if visible, or empty string",
  "company": "company or job title if visible, or empty string",
  "hasProfilePhoto": true
}

Do not include any explanation. Only output the JSON object.`

export async function extractContactFromImage(base64DataUrl, apiKey) {
  const parts = base64DataUrl.split(',')
  const base64 = parts[1]
  const mimeType = parts[0].split(';')[0].split(':')[1] || 'image/jpeg'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: 'low',
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    let msg = `API error ${response.status}`
    try {
      const err = await response.json()
      msg = err.error?.message ?? msg
    } catch {}
    throw new Error(msg)
  }

  const data = await response.json()
  const raw = JSON.parse(data.choices[0].message.content)

  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    phone: typeof raw.phone === 'string' ? raw.phone.trim() : '',
    company: typeof raw.company === 'string' ? raw.company.trim() : '',
  }
}
