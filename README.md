# Marginalia

AI-assisted reader app. Upload PDFs, read them, and chat with an AI about the content.

## Use online

Open **https://alexeykarnachev.github.io/marginalia/** in your browser.

### Install on iPad / iPhone

1. Open the link in Safari
2. Tap Share -> "Add to Home Screen"
3. The app will run in fullscreen standalone mode

### Install on Android

1. Open the link in Chrome
2. Tap the "Install app" prompt (or Menu -> "Add to Home Screen")

## Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Open the app and tap the gear icon
3. Paste your API key and choose a model (default: `anthropic/claude-sonnet-4`)

## Usage

- **Upload** a PDF from the library screen
- **Tap** a book to open it in the reader
- **Chat** button opens the AI assistant panel
- The AI sees your current page and selected text as context

## Privacy

Everything is stored locally in your browser: books (IndexedDB), API keys, chat history, and settings (localStorage). There is no backend server. The only external communication is between your browser and the OpenRouter API when you use the chat.

## Run locally

```
git clone git@github.com:alexeykarnachev/marginalia.git
cd marginalia
python3 -m http.server 8228 -d docs
```

Open http://localhost:8228 in your browser.
