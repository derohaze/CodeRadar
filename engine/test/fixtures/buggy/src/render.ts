/** Fixture: intentionally buggy. Review input for the engine's own tests. */

export interface CommentHost {
  innerHTML: string;
}

export function renderComment(host: CommentHost, comment: string): void {
  host.innerHTML = `<p>${comment}</p>`;
}
