// Strings the server needs: Stripe shipping option names and e-mails. Kept
// small on purpose; the site chrome is translated in _data/translations.yml.

const STRINGS = {
  fr: {
    delivery: "Livraison en Belgique (transporteur spécialisé)",
    pickup: "Retrait à l'atelier (Heusy) — gratuit",
    shipping_message: "Livraison en Belgique uniquement. Retrait gratuit à l'atelier, Chaussée de Theux 59, 4802 Heusy.",
    subject: (id) => `Votre commande ${id} — Atelier Sauvage`,
    intro: "Merci pour votre commande ! Nous la préparons et vous recontactons pour organiser la livraison ou le retrait.",
    items: "Vos objets",
    shipping: "Livraison",
    total: "Total payé",
    pickup_short: "Retrait à l'atelier",
    delivery_short: "Livraison en Belgique",
    withdrawal: "Vous disposez d'un droit de rétractation de 14 jours à compter de la réception. Les frais de renvoi sont à votre charge. Conditions générales de vente :",
    sign: "Atelier Sauvage — Chaussée de Theux 59, 4802 Heusy — ateliersauvageheusy@gmail.com — +32 495 29 22 25",
  },
  en: {
    delivery: "Delivery in Belgium (specialist carrier)",
    pickup: "Collect from the shop (Heusy) — free",
    shipping_message: "Delivery within Belgium only. Free collection from the shop, Chaussée de Theux 59, 4802 Heusy.",
    subject: (id) => `Your order ${id} — Atelier Sauvage`,
    intro: "Thank you for your order! We are preparing it and will contact you to arrange delivery or collection.",
    items: "Your pieces",
    shipping: "Delivery",
    total: "Total paid",
    pickup_short: "Collection from the shop",
    delivery_short: "Delivery in Belgium",
    withdrawal: "You have a 14-day right of withdrawal from receipt. Return carriage is at your expense. Terms and conditions:",
    sign: "Atelier Sauvage — Chaussée de Theux 59, 4802 Heusy — ateliersauvageheusy@gmail.com — +32 495 29 22 25",
  },
  nl: {
    delivery: "Levering in België (gespecialiseerde transporteur)",
    pickup: "Afhalen in het atelier (Heusy) — gratis",
    shipping_message: "Alleen levering in België. Gratis afhalen in het atelier, Chaussée de Theux 59, 4802 Heusy.",
    subject: (id) => `Je bestelling ${id} — Atelier Sauvage`,
    intro: "Bedankt voor je bestelling! We bereiden ze voor en nemen contact op om de levering of het afhalen te regelen.",
    items: "Je objecten",
    shipping: "Levering",
    total: "Betaald totaal",
    pickup_short: "Afhalen in het atelier",
    delivery_short: "Levering in België",
    withdrawal: "Je hebt een herroepingsrecht van 14 dagen vanaf ontvangst. De retourkosten zijn voor jouw rekening. Algemene voorwaarden:",
    sign: "Atelier Sauvage — Chaussée de Theux 59, 4802 Heusy — ateliersauvageheusy@gmail.com — +32 495 29 22 25",
  },
  de: {
    delivery: "Lieferung in Belgien (Spezialspedition)",
    pickup: "Abholung im Atelier (Heusy) — kostenlos",
    shipping_message: "Lieferung nur innerhalb Belgiens. Kostenlose Abholung im Atelier, Chaussée de Theux 59, 4802 Heusy.",
    subject: (id) => `Ihre Bestellung ${id} — Atelier Sauvage`,
    intro: "Vielen Dank für Ihre Bestellung! Wir bereiten sie vor und melden uns, um Lieferung oder Abholung zu vereinbaren.",
    items: "Ihre Objekte",
    shipping: "Lieferung",
    total: "Gezahlter Betrag",
    pickup_short: "Abholung im Atelier",
    delivery_short: "Lieferung in Belgien",
    withdrawal: "Sie haben ein 14-tägiges Widerrufsrecht ab Erhalt. Die Rücksendekosten tragen Sie. Allgemeine Geschäftsbedingungen:",
    sign: "Atelier Sauvage — Chaussée de Theux 59, 4802 Heusy — ateliersauvageheusy@gmail.com — +32 495 29 22 25",
  },
};

export function strings(lang) {
  return STRINGS[lang] || STRINGS.fr;
}
