/** Choosing an example edits a draft; it never sends or replaces existing words. */
export function appendChatExample(draft:string,example:string):string {
  return draft ? `${draft}\n\n${example}` : example;
}
