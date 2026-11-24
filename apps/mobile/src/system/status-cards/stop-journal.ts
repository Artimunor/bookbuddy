type StopMarker = { id: string; stopPending?: true };

/** Keep the existing native card ID until the bridge acknowledges its stop. */
export function createCardStopJournal<Card extends StopMarker>(persist: (card: Card | null) => Promise<void>, stop: (id: string) => Promise<void>) {
  return {
    async mark(card: Card): Promise<Card> {
      if (card.stopPending) return card;
      const marked = { ...card, stopPending: true } as const;
      await persist(marked);
      return marked;
    },
    async finish(card: Card): Promise<void> {
      if (!card.stopPending) throw new Error("Native card stop was not journaled");
      await stop(card.id);
      await persist(null);
    },
  };
}
