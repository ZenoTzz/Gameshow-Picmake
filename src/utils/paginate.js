export const PAGE_CONTENT_HEIGHT = 1440;
export const CARD_GAP = 8;

export function paginateGames(games, heights = [], maxPerPage = 6) {
  const pages = [];

  let currentPage = [];
  let currentHeight = 0;

  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    const cardHeight = Math.ceil(heights[index] || 232);
    const nextHeight = currentHeight + cardHeight + (currentPage.length ? CARD_GAP : 0);

    if (currentPage.length && (currentPage.length >= maxPerPage || nextHeight > PAGE_CONTENT_HEIGHT)) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(game);
    currentHeight += cardHeight + (currentPage.length > 1 ? CARD_GAP : 0);
  }

  if (currentPage.length) {
    pages.push(currentPage);
  }

  return pages.length ? pages : [[]];
}
