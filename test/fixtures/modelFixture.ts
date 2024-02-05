import { identifier, model, reference } from '../../src';
import z from 'zod';

export const chatRoomModel = model({
  name: 'ChatRoom',
  shape: {
    id: identifier(),
    ownerId: reference(),
  },
});

export const userModel = model({
  name: 'User',
  shape: {
    id: identifier(),
    name: z.string(),
    roomId: reference(),
    bestFriendId: z.string().optional(),
  },
});

export const messageModel = model({
  name: 'Message',
  shape: {
    id: identifier(),
    text: z.string(),
    authorId: reference(),
    recipientId: reference(),
    order: z.number(),
    roomId: reference(),
  },
});

export const roomEntity = { id: 'TestRoom', ownerId: '1' };

export const edUserEntity = {
  id: '1',
  name: 'ed',
  roomId: 'TestRoom',
};
export const aliceUserEntity = {
  id: '2',
  name: 'alice',
  roomId: 'TestRoom',
  bestFriendId: undefined,
};
export const messageEntity = {
  id: '3',
  text: 'hello',
  authorId: '1',
  recipientId: '2',
  order: 0,
  roomId: 'TestRoom',
};
