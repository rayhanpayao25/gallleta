export const CAFE = {
  name: "COFFEE ZZ",
  tagline: "WE GATHER, OVER COFFEE",
  hours: "9:00AM - 10:00PM",
  hoursNote: "DAILY",
  street: "Suterville",
  city: "Zamboanga City, Philippines",
  phone: "+63 912 345 6789",
  phoneHref: "tel:+639123456789",
  email: "coffeezz@gmail.com",
  emailHref: "mailto:coffeezz@gmail.com",
  mapsHref:
    "https://www.google.com/maps/@6.9179017,122.0460558,19.69z?entry=ttu&g_ep=EgoyMDI2MDkyOS4wIKXMDSoASAFQAw%3D%3D",
  mapsEmbed: "https://www.google.com/maps?q=6.9179017,122.0460558&z=19&output=embed",
  socials: [
    {
      id: "facebook" as const,
      label: "Facebook",
      href: "https://www.facebook.com/p/coffee-zz-cafe-61582118725483/",
    },
    {
      id: "instagram" as const,
      label: "Instagram",
      href: "https://www.instagram.com/coffeezz180",
    },
    {
      id: "tiktok" as const,
      label: "TikTok",
      href: "https://www.tiktok.com/@coffeezz.caf",
    },
  ],
} as const;
