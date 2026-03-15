# X-Computer Marketing Website

Official marketing website for X-Computer - AI-powered autonomous computer system.

## Features

- **Hero Section**: Eye-catching introduction with CTA
- **Features Showcase**: Highlight key capabilities
- **Pricing Plans**: Transparent pricing with trial option
- **Responsive Design**: Mobile-first, works on all devices
- **Fast Performance**: Built with Next.js 15 and optimized for speed

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Deployment**: Vercel

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Visit [http://localhost:3001](http://localhost:3001) to view the site.

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Configure environment variables:
   - `NEXT_PUBLIC_API_URL`: Backend API URL
4. Deploy

### Manual Deployment

```bash
npm run build
npm start
```

## Environment Variables

Create `.env.local` for local development:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Project Structure

```
marketing/
├── app/
│   ├── page.tsx          # Homepage
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── public/               # Static assets
├── package.json
└── README.md
```

## Links

- Main App: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:4000](http://localhost:4000)
- Marketing Site: [http://localhost:3001](http://localhost:3001)

## License

Proprietary - X-Computer © 2026
