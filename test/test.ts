import test from 'ava'

import {
  graph,
  identifier,
  manyToOne,
  model,
  oneToOne,
  view,
  reference,
  target,
  source,
  InferView,
  poolSchema, entityPool, graphSchema,
} from '../src';
import z from 'zod';

const chatRoomModel = model({
  name: 'ChatRoom',
  shape: {
    id: identifier(),
    ownerId: reference(),
  },
});

const userModel = model({
  name: 'User',
  shape: {
    id: identifier(),
    name: z.string(),
    roomId: reference(),
  },
});

const messageModel = model({
  name: 'Message',
  shape: {
    id: identifier(),
    text: z.string(),
    authorId: reference(),
    recipient: reference(),
    order: z.number(),
    roomId: reference(),
  },
});


const userRoomRel = manyToOne(
  source(userModel, 'roomId'),
  target(chatRoomModel, 'users'),
);

const chatRoomOwnerRel = oneToOne(
  source(chatRoomModel, 'ownerId'),
  target(userModel),
);

const authorRel = manyToOne(
  source(messageModel, 'authorId'),
  target(userModel, 'inbox'),
);
const recipientRel = manyToOne(
  source(messageModel, 'recipient'),
  target(userModel, 'outbox'),
);
const messageRoomRel = manyToOne(
  source(messageModel, 'roomId'),
  target(chatRoomModel, 'messages'),
);

const messageView = view(messageModel).outgoing([
  authorRel,
  recipientRel,
  messageRoomRel,
]);
export type MessageView = InferView<typeof messageView>;

const userView = view(userModel)
  .outgoing([userRoomRel])
  .incoming([authorRel, recipientRel]);
export type UserView = InferView<typeof userView>;

const chatRoomView = view(chatRoomModel).incoming([
  messageRoomRel,
  userRoomRel,
]);
export type ChatRoomView = InferView<typeof chatRoomView>;

const roomEntity = { id: 'TestRoom', ownerId: '1' };

const edUserEntity = {
  id: '1',
  name: 'ed',
  roomId: 'TestRoom',
};
const aliceUserEntity = {
  id: '2',
  name: 'alice',
  roomId: 'TestRoom',
};
const messageEntity = {
  id: '3',
  text: 'hello',
  authorId: '1',
  recipient: '2',
  order: 0,
  roomId: 'TestRoom',
};



test('pool', t => {
  const chatRoomPool = entityPool(poolSchema(chatRoomModel, [userModel, messageModel])).create(roomEntity, [
    { name: 'User', entity: edUserEntity },
    { name: 'User', entity: aliceUserEntity },
    { name: 'Message', entity: messageEntity },
  ]);

  chatRoomPool.apply([{ operation: 'Update', name: 'User', entity: {
      id: '2',
      name: 'alice is awesome'
    }},
    { operation: 'Delete', name: 'User', entity: {id: '1'}}])
  console.log(chatRoomPool.entities)
});

// test('graph', t => {
//   const chatRoomGraph = graph(graphSchema(chatRoomView, [userView, messageView])).create(
//     roomEntity,
//     [{ name: 'User', entity: edUserEntity },
//       { name: 'User', entity: aliceUserEntity },
//       { name: 'Message', entity: messageEntity }]
//   );
//
//   console.log(chatRoomGraph.pool)
// });