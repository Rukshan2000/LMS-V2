/** Click-to-WhatsApp link: opens WhatsApp with the message ready; staff tap Send. */
export const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
