import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { Analytics } from "@vercel/analytics/react";
import "@/styles/globals.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Arjun Aditya</title>
        <meta
          name="description"
          content="Reactional Programmer who likes to build things."
        />
        <link rel="icon" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Silkscreen:wght@400;700&display=swap"
        />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-neutral-50 font-sans antialiased">
        {children}
        <Analytics />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-sm text-neutral-700">
        <p>Page not found.</p>
        <a
          href="/"
          className="mt-2 inline-block text-neutral-500 underline hover:text-neutral-900"
        >
          Back home
        </a>
      </div>
    );
  }

  console.error(error);
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 text-sm text-neutral-700">
      <p>Something broke.</p>
      <a
        href="/"
        className="mt-2 inline-block text-neutral-500 underline hover:text-neutral-900"
      >
        Back home
      </a>
    </div>
  );
}
