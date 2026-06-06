export const PAGE_CONTENT_HEIGHT = 1540;
export const FULL_PAGE_CONTENT_HEIGHT = 1836;
export const CARD_GAP = 8;

export function paginateGames(games, heights = [], options = {}) {
  const normalizedOptions = typeof options === "number" ? { maxPerPage: options } : options;
  const {
    compactFollowupPages = false,
    firstPageHeight = PAGE_CONTENT_HEIGHT,
    followupPageHeight = compactFollowupPages ? FULL_PAGE_CONTENT_HEIGHT : PAGE_CONTENT_HEIGHT,
    maxPerPage = 6,
  } = normalizedOptions;
  const pages = [];

  let currentPage = [];
  let currentHeight = 0;

  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    const cardHeight = Math.ceil(heights[index] || 232);
    const currentPageLimit = pages.length === 0 ? firstPageHeight : followupPageHeight;
    const nextHeight = currentHeight + cardHeight + (currentPage.length ? CARD_GAP : 0);

    if (currentPage.length && (currentPage.length >= maxPerPage || nextHeight > currentPageLimit)) {
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
