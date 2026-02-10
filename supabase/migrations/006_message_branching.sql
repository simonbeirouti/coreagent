-- CoreAgent Phase 2: Message Branching Support
-- Migration: 006_message_branching.sql
-- Enables edit functionality with branching (like ChatGPT)

-- Add parent_id column to messages table for tree structure
-- Each message points to its parent (the previous message in the thread)
-- When a message is edited, a new sibling is created with the same parent_id
ALTER TABLE messages
ADD COLUMN parent_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- Add index for efficient tree traversal
CREATE INDEX idx_messages_parent_id ON messages(parent_id);

-- RLS policies for UPDATE on messages (currently missing)
-- Users can update messages in their conversations
CREATE POLICY "Users can update messages in their conversations" ON messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

-- RLS policies for DELETE on messages (currently missing)
-- Users can delete messages in their conversations
CREATE POLICY "Users can delete messages in their conversations" ON messages
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

-- Comment explaining the branching model
COMMENT ON COLUMN messages.parent_id IS 'References the parent message in the conversation tree. NULL for the first message. Multiple messages with the same parent_id represent branches (edits).';
