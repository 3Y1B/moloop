# Local AI API

Self-hosted AI models on a DGX Spark, available from anywhere. Most endpoints are OpenAI-compatible, so the official `openai` SDKs work: point them at the base URL below.

| What | Endpoint | Model | Speed |
|---|---|---|---|
| Chat / text generation | `POST /v1/chat/completions` | `qwen3.5:4b` | ~67 tokens/s, first token in ~0.3 s |
| Typed decisions (Jev-style) | `POST /v1/systemone` | `qwen3.5:4b` | ~0.1–0.2 s per question |
| Speech to text | `POST /v1/audio/transcriptions` | `qwen3-asr-1.7b` | 5 s clip in ~0.6 s, 3 min in ~4 s |
| Text to speech | `POST /v1/audio/speech` | `qwen3-tts` | ~1.4× realtime (3 s of speech in ~2 s) |

## Setup

**Base URL:** `https://spark-2053.taild1460f.ts.net/v1`

**Auth:** send your API key as a bearer token on every request:

```
Authorization: Bearer YOUR_API_KEY
```

Ask the organiser for a key. In the examples below, set it as an environment variable:

```bash
export SPARK_API_KEY=YOUR_API_KEY
```

Client setup used by the SDK examples:

```js
// Node.js 20+ — npm install openai
import OpenAI from "openai";
const client = new OpenAI({
  baseURL: "https://spark-2053.taild1460f.ts.net/v1",
  apiKey: process.env.SPARK_API_KEY,
});
```

```python
# Python — pip install openai
import os
from openai import OpenAI
client = OpenAI(base_url="https://spark-2053.taild1460f.ts.net/v1",
                api_key=os.environ["SPARK_API_KEY"])
```

---

## 1. Chat — `POST /v1/chat/completions`

Standard OpenAI chat completions with `model: "qwen3.5:4b"`. Streaming (`stream: true`) works.

```bash
curl https://spark-2053.taild1460f.ts.net/v1/chat/completions \
  -H "Authorization: Bearer $SPARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:4b",
    "messages": [{"role": "user", "content": "Give me 3 hackathon project ideas."}],
    "reasoning_effort": "none"
  }'
```

```js
const r = await client.chat.completions.create({
  model: "qwen3.5:4b",
  messages: [{ role: "user", content: "Give me 3 hackathon project ideas." }],
  reasoning_effort: "none",
});
console.log(r.choices[0].message.content);
```

```python
r = client.chat.completions.create(
    model="qwen3.5:4b",
    messages=[{"role": "user", "content": "Give me 3 hackathon project ideas."}],
    reasoning_effort="none",
)
print(r.choices[0].message.content)
```

**Tip:** `reasoning_effort: "none"` turns off the model's thinking step and makes replies much faster. Leave it out for harder questions where you want it to think first.

---

## 2. Typed decisions (Jev-style) — `POST /v1/systemone`

Ask questions about some content and get **structured answers with probabilities** instead of free text. Same wire format as [TypeSafe's Jev API](https://docs.typesafe.ai/api), so their official SDKs work too.

Three question types:

| Type | Use it for | Answer |
|---|---|---|
| `noul` | yes/no questions | `noul`: probability the answer is yes (0–1) |
| `choice` | pick one option from a set | `choice`, `probabilities` per option, `confidence` |
| `score` | rate on an ordered scale | `score` (can land between levels), `legend`, `probabilities`, `confidence` |

```bash
curl https://spark-2053.taild1460f.ts.net/v1/systemone \
  -H "Authorization: Bearer $SPARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-latest",
    "state": "Help! My payouts have been failing for 3 days.",
    "questions": {
      "is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"},
      "department": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {"billing": "Payments, refunds", "technical": "Bugs, outages", "sales": "Pricing, upgrades"}
      },
      "frustration": {
        "type": "score",
        "instructions": "How frustrated is the customer?",
        "criteria": ["Calm", "Frustrated", "Very angry"]
      }
    }
  }'
```

Response:

```json
{
  "model": "qwen3.5:4b",
  "answers": {
    "is_urgent":   {"type": "noul", "noul": 0.9985},
    "department":  {"type": "choice", "choice": "billing",
                    "probabilities": {"billing": 0.7657, "technical": 0.2281, "sales": 0.0063},
                    "confidence": 0.6485},
    "frustration": {"type": "score", "score": 0.98,
                    "legend": {"0": "Calm", "1": "Frustrated", "2": "Very angry"},
                    "probabilities": {"0": 0.0193, "1": 0.9785, "2": 0.0022},
                    "confidence": 0.9677}
  },
  "usage": {"input_tokens": 377, "output_tokens": 3}
}
```

**With TypeSafe's SDKs:** set two environment variables, and the code is unchanged:

```bash
export TYPESAFE_BASE_URL=https://spark-2053.taild1460f.ts.net
export TYPESAFE_API_KEY=$SPARK_API_KEY
```

```ts
// npm install @typesafe-ai/sdk
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const { answers } = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    billing: noul("Is this ticket about billing?"),
    category: choice("What is this ticket about?", { billing: null, technical: null, other: null }),
    urgency: score("How urgent is this ticket?", ["can wait", "this week", "today"]),
  },
});
console.log(answers.billing.noul, answers.category.choice, answers.urgency.score);
```

```python
# pip install typesafe-sdk
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

with TypeSafeClient() as client:
    r = client.system_one(
        state={"document": "I was charged twice. Please fix this ASAP."},
        questions={
            "billing": Noul(instructions="Is this ticket about billing?"),
            "tone": Choice(instructions="What is the customer's tone?",
                           criteria={"calm": None, "frustrated": None, "angry": None}),
        },
    )
print(r.nouls["billing"].noul, r.choices["tone"].choice)
```

**Good to know:**
- Ask one specific thing per question. Narrow questions work best.
- `state` can be a string, or any JSON object or array.
- It's a 4B model, not TypeSafe's trained Jev model, so the probabilities show the model's relative preference between your options rather than calibrated certainty. Treat 50/50-ish answers as "unsure".
- Limits: 2–16 options per question, up to 32 questions per request. Questions run one after another, so more questions means a slower response.

---

## 3. Speech to text — `POST /v1/audio/transcriptions`

OpenAI-compatible transcription with `model: "qwen3-asr-1.7b"` (`whisper-1` also works as the model name). It detects the language automatically and supports 30 languages.

```bash
curl https://spark-2053.taild1460f.ts.net/v1/audio/transcriptions \
  -H "Authorization: Bearer $SPARK_API_KEY" \
  -F file=@audio.mp3 \
  -F model=qwen3-asr-1.7b
# {"text": "Hey, can you send me the invoice for September before Friday?"}
```

```js
import fs from "node:fs";
const r = await client.audio.transcriptions.create({
  model: "qwen3-asr-1.7b",
  file: fs.createReadStream("audio.mp3"),
});
console.log(r.text);
```

```python
r = client.audio.transcriptions.create(model="qwen3-asr-1.7b", file=open("audio.mp3", "rb"))
print(r.text)
```

Optional fields:

| Field | Values |
|---|---|
| `language` | e.g. `en`, `zh`. Skips auto-detection |
| `prompt` | hint for names and jargon, e.g. `"Vocabulary: Kubernetes, Sarah"` |
| `response_format` | `json` (default), `text`, `verbose_json` (adds language, duration, segments), `srt`, `vtt` |

**Good to know:**
- Any common audio format works (mp3, wav, m4a, webm, ogg…). Limits: 25 MB and 1 hour per file.
- Subtitle and segment timestamps are per ~30-second chunk, not per word.
- Browser recordings (`MediaRecorder` → webm) can be uploaded directly.

---

## 4. Text to speech — `POST /v1/audio/speech`

OpenAI-compatible speech with `model: "qwen3-tts"`. **You choose the voice by describing it.**

```bash
curl https://spark-2053.taild1460f.ts.net/v1/audio/speech \
  -H "Authorization: Bearer $SPARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-tts",
    "voice": "a cheerful young Scottish woman, fast and bubbly",
    "input": "What a lovely morning it is!"
  }' \
  --output speech.mp3
```

```js
import fs from "node:fs";
const speech = await client.audio.speech.create({
  model: "qwen3-tts",
  voice: "jarvis",
  instructions: "slightly amused",
  input: "Welcome home, sir. I took the liberty of ordering pizza.",
});
fs.writeFileSync("speech.mp3", Buffer.from(await speech.arrayBuffer()));
```

```python
speech = client.audio.speech.create(
    model="qwen3-tts",
    voice="a deep, gravelly old pirate captain",
    input="Arr, the treasure be buried beneath the old oak tree.",
)
speech.write_to_file("speech.mp3")
```

**Choosing a voice:**

| Option | Example |
|---|---|
| Describe any voice in `voice` | `"a calm older British man, slow and warm"` |
| Use a preset | `jarvis` (calm Australian AI assistant), `british-butler`, `narrator`, `news-anchor`, `cheerful` |
| Preset plus extra direction | `voice: "narrator"`, `instructions: "whispering, tense"` |
| OpenAI voice names | `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse` |
| Try a different take | add `"seed": 123` |

`GET /v1/audio/voices` lists the presets and languages.

**Consistency:** the same voice description always uses the same seed, so an identical request gives identical audio. Keep your description exactly the same across calls to keep a character's voice.

Optional fields:

| Field | Values |
|---|---|
| `response_format` | `mp3` (default), `wav`, `opus`, `aac`, `flac`, `pcm` (raw 24 kHz 16-bit mono) |
| `speed` | `0.25`–`4.0` (default `1.0`) |
| `language` | `auto` (default), `english`, `chinese`, `japanese`, `korean`, `german`, `french`, `russian`, `portuguese`, `spanish`, `italian` |
| `seed` | any integer, for a different take of the same description |

**Good to know:**
- Up to 2,000 characters per request.
- The whole file is returned at once; there's no streaming. For long text, split it into sentences and request them one by one to start playback sooner.

---

## Other endpoints

- `GET /v1/models` lists the available models.
- `GET /` is a health check and needs no key.

## Limits and errors

| Limit | Value |
|---|---|
| Requests per key | 30 per minute |
| Concurrent requests (whole server) | 4 at a time |
| Chat output | max 2,048 tokens per reply |
| Audio upload | 25 MB, 1 hour |
| Text to speech input | 2,000 characters |

| Status | Meaning | What to do |
|---|---|---|
| `401` | missing or wrong API key | check the `Authorization: Bearer …` header |
| `400` / `422` | bad request (unknown model, voice, field…) | the `error` message says what's wrong |
| `413` | upload too large | keep audio under 25 MB |
| `429` | rate limit, or server busy | wait a second and retry with backoff |
| `502` | a model service is restarting | retry shortly |

Errors come back as JSON: `{"error": "…"}`.

**Tips:**
- The models share one GPU, so long chat replies or big transcriptions slow down everyone's requests a little. Keep requests small where you can.
- If a connection fails before you get any response, just retry. The server sits behind a relay that occasionally drops a connection.
