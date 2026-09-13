import { marked } from "marked";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/blog-post";
import { getBlogPost } from "@/lib/content";

export function meta({ params }: Route.MetaArgs) {
  const post = getBlogPost(params.slug);
  return [{ title: post ? `${post.title} — Arjun Aditya` : "Not found" }];
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = getBlogPost(slug!);

  if (!post) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-sm text-neutral-700">
        <p>Post not found.</p>
        <Link to="/blogs" className="mt-2 inline-block text-neutral-500 underline hover:text-neutral-900">
          Back to blog
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <Link to="/blogs" className="text-sm text-neutral-500 underline hover:text-neutral-900">
        ← Blog
      </Link>
      <h1 className="mt-4 text-lg font-medium text-neutral-900">{post.title}</h1>
      <p className="mt-1 text-xs text-neutral-400">{post.date}</p>
      <div
        className="prose prose-neutral prose-sm mt-8 max-w-none"
        dangerouslySetInnerHTML={{ __html: marked.parse(post.content) as string }}
      />
    </div>
  );
}
