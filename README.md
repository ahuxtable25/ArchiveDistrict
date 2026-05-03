# ArchiveDistrict — Business OS

Vintage resale management app. Built with React + Vite, deployed on Vercel.

## Deploy to Vercel

1. Push this folder to a GitHub repository
2. Connect the repo to [vercel.com](https://vercel.com)
3. Add environment variable in Vercel dashboard:
   - `ANTHROPIC_API_KEY` = your key from [console.anthropic.com](https://console.anthropic.com)
4. Deploy — done

## Local development

```bash
npm install
npm run dev
```

Add a `.env.local` file for local AI drafting:
```
ANTHROPIC_API_KEY=your_key_here
```
