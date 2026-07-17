// Content registry for the public /explore pages (frontend/src/views/ExploreHubPage.vue
// and ExploreFeaturePage.vue). Keys match the *_ prefix-stripped feature keys already
// used by backend/routes/analytics.js's FEATURES registry, so tracking stays consistent
// between authenticated in-app usage and pre-signup marketing interest.
//
// `ctaRoute` is where a logged-in visitor gets sent ("go use it now"); logged-out
// visitors always get routed to /signup instead (see ExploreFeaturePage.vue).

export const exploreFeatures = {
  blog: {
    label: 'Blog',
    icon: '✍️',
    tagline: 'Share your thoughts with the world',
    description: "Prosaurus Blog is a simple, distraction-free place to write. Draft a post, come back to it later, and publish when it's ready — no algorithm deciding who sees it, just the people who follow you.",
    highlights: [
      'A clean writing space built for actually finishing what you start',
      'Publish to your own shareable blog URL',
      'Readers can follow along and comment without needing an algorithm to surface it',
    ],
    monetized: false,
    ctaRoute: '/blog',
  },
  chat: {
    label: 'Chat',
    icon: '💬',
    tagline: 'Real conversations, not algorithmic feeds',
    description: "Chat on Prosaurus is built for talking to people you actually know — group rooms, direct messages, and scheduled messages, without ads or engagement bait deciding what you see.",
    highlights: [
      'Group rooms and direct messages',
      'Schedule a message to send later',
      'No ads, no algorithmic ranking of your conversations',
    ],
    monetized: false,
    ctaRoute: '/chat',
  },
  friends: {
    label: 'Friends',
    icon: '🧑‍🤝‍🧑',
    tagline: 'Connect with people you actually know',
    description: 'Your Prosaurus feed only shows people you\'re actually connected to — friend requests, real profiles, and updates from people you know, not strangers an algorithm thinks you should follow.',
    highlights: [
      'Friend requests and real, human-run profiles',
      'See updates from people you actually know',
      'No public follower-count chasing, no influencers',
    ],
    monetized: false,
    ctaRoute: '/friends',
  },
  lyrics: {
    label: 'Lyric Lab',
    icon: '📝',
    tagline: 'Capture lyric ideas before you lose them',
    description: "Lyric Lab is a home for half-formed song ideas — capture a line the moment it comes to you, organize fragments into full songs, and collaborate with co-writers as the song takes shape.",
    highlights: [
      'Capture lyric fragments and ideas as they come to you',
      'Organize fragments into complete songs',
      'Collaborate with other songwriters on the same piece',
    ],
    monetized: false,
    ctaRoute: '/lyrics',
  },
  sessions: {
    label: 'Sessions',
    icon: '🎙️',
    tagline: 'Track and manage your recording sessions',
    description: "Sessions keeps a running record of every band practice and individual take you record — upload or record straight from the browser, organize by band or instrument, and mix quick mashups from your takes.",
    highlights: [
      'Record or upload band practice and individual sessions',
      'Organize by band, instrument, and date',
      'Mix a new take against a backing track right in the browser',
      'Free accounts get 3 sessions of each type — Pro removes the limit',
    ],
    monetized: true,
    ctaRoute: '/sessions',
  },
  art_gallery: {
    label: 'Art Gallery',
    icon: '🖼️',
    tagline: 'A personal gallery for your artwork',
    description: 'Art Gallery gives your artwork a real home — upload pieces, arrange them into a personal gallery, and share it with a public URL anyone can view, no account required.',
    highlights: [
      'Upload and organize your artwork',
      'A shareable public gallery URL for anyone to view',
      'A staging ground before promoting a piece to the Artist Showcase',
    ],
    monetized: false,
    ctaRoute: '/art-gallery',
  },
  artist_showcase: {
    label: 'Artist Showcase',
    icon: '🛍️',
    tagline: 'Sell your original artwork and prints',
    description: "Artist Showcase turns your gallery into a real storefront. List original pieces and prints for sale, connect a Stripe account to get paid directly, and Prosaurus Pro subscribers keep 100% of the sale price minus standard payment processing.",
    highlights: [
      'List and sell original artwork and prints directly through Prosaurus',
      'Payments handled securely by Stripe, paid straight to your bank account',
      'Free tier: 5% platform fee per sale — Pro: 0% platform fee',
    ],
    monetized: true,
    ctaRoute: '/collections',
  },
  kanban: {
    label: 'Kanban',
    icon: '📋',
    tagline: 'A visual board for tracking your work',
    description: 'Kanban gives you a lightweight, visual way to organize projects and tasks — drag cards across columns as work moves from idea to done, without a heavyweight project-management tool getting in the way.',
    highlights: [
      'Drag-and-drop task board',
      'Organize by project',
      'Stays out of your way — no forced workflow',
    ],
    monetized: false,
    ctaRoute: '/kanban',
  },
  company_portal: {
    label: 'Company Portal',
    icon: '🏢',
    tagline: 'The story behind Prosaurus, and where it might go next',
    description: "Prosaurus started as a side project to solve a simple problem: communication is the hardest part of managing any project. The Company Portal is where that story lives, along with a look at what a real Prosaurus team might look like someday, and a Help Desk if you ever need to reach us.",
    highlights: [
      "Read the story of why Prosaurus was built",
      'A look at future roles, if Prosaurus ever grows into a real company',
      'A direct line to the Help Desk for support and feedback',
    ],
    monetized: false,
    ctaRoute: '/about-company',
  },
  band_pages: {
    label: 'Band Pages',
    icon: '🎸',
    tagline: "Give your band its own home on Prosaurus",
    description: 'Every band on Prosaurus can have its own page — members, a shared setlist, and a place to organize practice sessions together. Invite bandmates by email and keep everyone on the same page, literally.',
    highlights: [
      'A shared page for your band, with members and setlists',
      'Invite bandmates by email',
      'Practice sessions organized by band, right alongside Sessions',
    ],
    monetized: false,
    ctaRoute: '/sessions',
  },
}

export const exploreCategories = [
  {
    label: 'Connect',
    description: 'Social features built around people you actually know',
    features: ['chat', 'friends', 'band_pages'],
  },
  {
    label: 'Musician Tools',
    description: 'Tools for musicians, composers, and audio enthusiasts',
    features: ['sessions', 'lyrics'],
  },
  {
    label: 'Artist Tools',
    description: 'Creative tools for visual artists and designers',
    features: ['art_gallery', 'artist_showcase'],
  },
  {
    label: 'Writer Tools',
    description: 'Utilities for writers, bloggers, and content creators',
    features: ['blog'],
  },
  {
    label: 'Developer Tools',
    description: 'Productivity tools for programmers and developers',
    features: ['kanban'],
  },
  {
    label: 'About Prosaurus',
    description: 'Who we are and how to reach us',
    features: ['company_portal'],
  },
]
