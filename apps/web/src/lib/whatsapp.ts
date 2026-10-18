/** Click-to-WhatsApp link: opens WhatsApp with the message ready; staff tap Send. No phone: they pick the chat. */
export const waLink = (phone: string | null, text: string) =>
  `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
