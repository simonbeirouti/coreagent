/**
 * Message Tree Utilities
 * 
 * Handles branching conversation trees for ChatGPT-style message editing.
 * Messages form a tree structure via parent_id references.
 */

import { Message } from '@/types';

/**
 * Branch selections - maps parent message IDs to the selected child index
 * Example: { "msg-123": 1 } means at the branch point after msg-123, we're viewing the 2nd sibling
 */
export type BranchSelections = Record<string, number>;

/**
 * Branch info for a message - used to render navigation arrows
 */
export interface BranchInfo {
  /** The parent message ID that creates this branch point */
  parentId: string | null;
  /** Total number of siblings (including this message) */
  siblingCount: number;
  /** Current sibling index (0-based) */
  currentIndex: number;
  /** All sibling message IDs in order */
  siblingIds: string[];
}

/**
 * Build a map of parent_id -> child messages
 */
function buildChildrenMap(messages: Message[]): Map<string | null, Message[]> {
  const childrenMap = new Map<string | null, Message[]>();
  
  for (const msg of messages) {
    const parentId = msg.parent_id ?? null;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(msg);
  }
  
  // Sort children by created_at for consistent ordering
  for (const children of childrenMap.values()) {
    children.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }
  
  return childrenMap;
}

/**
 * Resolve the visible thread of messages based on branch selections
 * 
 * @param messages - Flat array of all messages in the conversation
 * @param branchSelections - Map of parent_id -> selected sibling index
 * @returns The linear thread of messages to display
 */
export function resolveVisibleThread(
  messages: Message[],
  branchSelections: BranchSelections = {}
): Message[] {
  if (messages.length === 0) return [];
  
  const childrenMap = buildChildrenMap(messages);
  const thread: Message[] = [];
  
  // Start with root messages (parent_id is null/undefined)
  let currentParentId: string | null = null;
  
  while (true) {
    const children: Message[] = childrenMap.get(currentParentId) ?? [];
    if (children.length === 0) break;
    
    // Determine which sibling to follow
    const selectedIndex = branchSelections[currentParentId ?? 'root'] ?? 0;
    const clampedIndex = Math.max(0, Math.min(selectedIndex, children.length - 1));
    const selectedMessage: Message = children[clampedIndex];
    
    thread.push(selectedMessage);
    currentParentId = selectedMessage.id;
  }
  
  return thread;
}

/**
 * Get branch info for each message in the visible thread
 * This is used to render branch navigation arrows
 * 
 * @param messages - Flat array of all messages
 * @param branchSelections - Current branch selections
 * @returns Map of message ID -> branch info
 */
export function getBranchInfo(
  messages: Message[],
  branchSelections: BranchSelections = {}
): Map<string, BranchInfo> {
  const childrenMap = buildChildrenMap(messages);
  const branchInfoMap = new Map<string, BranchInfo>();
  
  for (const [parentId, children] of childrenMap.entries()) {
    // Skip if only one child (no branching)
    if (children.length <= 1) continue;
    
    const selectedIndex = branchSelections[parentId ?? 'root'] ?? 0;
    const clampedIndex = Math.max(0, Math.min(selectedIndex, children.length - 1));
    
    // Only the selected message in each branch gets the branch info
    // (we only show arrows on the currently visible message at a branch point)
    const selectedMessage = children[clampedIndex];
    
    branchInfoMap.set(selectedMessage.id, {
      parentId: parentId,
      siblingCount: children.length,
      currentIndex: clampedIndex,
      siblingIds: children.map(c => c.id),
    });
  }
  
  return branchInfoMap;
}

/**
 * Navigate to a different sibling at a branch point
 * 
 * @param branchSelections - Current selections
 * @param parentId - The parent message ID (or 'root' for root messages)
 * @param newIndex - The new sibling index to select
 * @returns Updated branch selections
 */
export function selectBranch(
  branchSelections: BranchSelections,
  parentId: string | null,
  newIndex: number
): BranchSelections {
  return {
    ...branchSelections,
    [parentId ?? 'root']: newIndex,
  };
}

/**
 * Check if a message has any children (is not a leaf)
 */
export function hasChildren(messages: Message[], messageId: string): boolean {
  return messages.some(m => m.parent_id === messageId);
}

/**
 * Find all descendants of a message (for bulk operations)
 */
export function findDescendants(messages: Message[], messageId: string): Message[] {
  const descendants: Message[] = [];
  const toProcess = [messageId];
  
  while (toProcess.length > 0) {
    const currentId = toProcess.pop()!;
    const children = messages.filter(m => m.parent_id === currentId);
    descendants.push(...children);
    toProcess.push(...children.map(c => c.id));
  }
  
  return descendants;
}
