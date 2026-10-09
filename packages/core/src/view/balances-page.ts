/** The Balances table's rows per page: the server cuts `GET /view/balances` by it and the screen
 *  pages by it, so neither can disagree with the other. A module of its own so a test can move it. */
export const BALANCES_PAGE_SIZE = 6;
