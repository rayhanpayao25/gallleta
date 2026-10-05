import { CAFE } from "@/lib/cafe";

const iconClass = "h-4 w-4 fill-current";

function SocialIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={iconClass}>
      <path d="M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.6c0-.9.3-1.6 1.6-1.6h1.7V4.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.2h2.8V22h3.4Z" />
    </svg>
  );
}

export function SocialLinks({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`.trim()}>
      {CAFE.socials.map((social) => (
        <a
          key={social.id}
          href={social.href}
          target="_blank"
          rel="noreferrer"
          aria-label={social.label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:border-white hover:text-white"
        >
          <SocialIcon />
        </a>
      ))}
    </div>
  );
}
