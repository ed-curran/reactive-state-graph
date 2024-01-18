import test from 'ava';

import { graphSchema, InferView, manyToOne, view } from '../src';
import { source, target, OneWayGraph, mutablePool } from '../src/oneWayGraph';
import { poolSchema } from '../src';

import {
  aliceUserEntity,
  chatRoomModel,
  edUserEntity,
  messageEntity,
  messageModel,
  roomEntity,
  userModel,
} from './fixtures/modelFixture';

const userRoomRel = manyToOne(
  source(userModel, 'roomId').auto(),
  target(chatRoomModel).as('users'),
);

const chatRoomOwnerRel = manyToOne(
  source(chatRoomModel, 'ownerId').auto(),
  target(userModel),
);

const authorRel = manyToOne(
  source(messageModel, 'authorId').auto(),
  target(userModel).as('inbox'),
);
const recipientRel = manyToOne(
  source(messageModel, 'recipientId').auto(),
  target(userModel).as('outbox'),
);
const messageRoomRel = manyToOne(
  source(messageModel, 'roomId').auto(),
  target(chatRoomModel).as('messages'),
);

const messageView = view(messageModel).outgoing([
  authorRel,
  recipientRel,
  messageRoomRel,
]);

type MessageView = InferView<typeof messageView>;

const userView = view(userModel)
  .outgoing([userRoomRel])
  .incoming([authorRel, recipientRel]);
type UserView = InferView<typeof userView>;

const chatRoomView = view(chatRoomModel)
  .outgoing([chatRoomOwnerRel])
  .incoming([messageRoomRel, userRoomRel]);
type ChatRoomView = InferView<typeof chatRoomView>;

test.skip('pool', (t) => {
  const chatRoomPool = mutablePool(
    poolSchema(chatRoomModel, [userModel, messageModel]),
  );
  const test = chatRoomPool.createEntity({
    name: 'User',
    entity: edUserEntity,
  });

  const root = chatRoomPool.createRoot(roomEntity, [
    { name: 'User', entity: edUserEntity },
    { name: 'User', entity: aliceUserEntity },
    { name: 'Message', entity: messageEntity },
  ]);

  chatRoomPool.getState.apply([
    {
      operation: 'Update',
      name: 'User',
      entity: {
        id: '2',
        name: 'alice is awesome',
      },
    },
    { operation: 'Delete', name: 'User', entity: { id: '1' } },
  ]);
  console.log(root);
});

test.skip('graph', (t) => {
  const chatRoomGraph = new OneWayGraph(
    graphSchema(chatRoomView, [userView, messageView]),
  );
  const root = chatRoomGraph.withRoot(roomEntity, [
    { name: 'User', entity: edUserEntity },
    { name: 'User', entity: aliceUserEntity },
    { name: 'Message', entity: messageEntity },
  ]);

  chatRoomGraph.getPool().apply([
    {
      operation: 'Update',
      name: 'User',
      entity: {
        id: '2',
        name: 'alice is awesome',
      },
    },
    { operation: 'Delete', name: 'User', entity: { id: '1' } },
  ]);
});
