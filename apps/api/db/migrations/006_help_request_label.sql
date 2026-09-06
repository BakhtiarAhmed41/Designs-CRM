-- Allow order chats opened after delivery to be tagged as a help request.

ALTER TABLE conversations
  MODIFY COLUMN label ENUM('EDIT','PAYMENT','CUSTOM','IMPORTANT','HELP') NULL;
