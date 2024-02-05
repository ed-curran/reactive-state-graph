import test from 'ava';
import {
  graphSchema,
  identifier,
  InferView,
  manyToOne,
  model,
  oneToMany,
  oneToOne,
  poolSchema,
  reference,
  view,
} from '../src';
import {
  aliceUserEntity,
  edUserEntity,
  messageEntity,
  messageModel,
} from './fixtures/modelFixture';
import { source, target, ValtioGraph, ValtioPool } from '../src/valtio';
import z from 'zod';
import { proxy, subscribe } from 'valtio/vanilla';
import { proxyArrayMap } from '../src/valtio/proxyArrayMap';
const chatRoomModel = model({
  name: 'ChatRoom',
  shape: {
    id: identifier(),
    description: z.string(),
    ownerId: reference(),
    // userIds: z.array(z.string()),
  },
});
const userModel = model({
  name: 'User',
  shape: {
    id: identifier(),
    name: z.string(),
    roomId: reference(),
    bestFriendId: z.string().optional(),
  },
});

// const roomUserRel = oneToMany(
//   source(chatRoomModel, 'userIds'),
//   target(userModel).as('room'),
// );
const userRoomRel = manyToOne(
  source(userModel, 'roomId').auto(),
  target(chatRoomModel).as('users'),
);

// const chatRoomOwnerRel = manyToOne(
//   source(chatRoomModel, 'ownerId').auto(),
//   target(userModel),
// );

const authorRel = manyToOne(
  source(messageModel, 'authorId').auto(),
  target(userModel).as('outbox'),
);
const recipientRel = manyToOne(
  source(messageModel, 'recipientId').auto(),
  target(userModel).as('inbox'),
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

const bestFriendRel = oneToOne(
  source(userModel, 'bestFriendId').auto(),
  target(userModel).as('bestFriendOf'),
);

type MessageView = InferView<typeof messageView>;

const userView = view(userModel)
  .outgoing([bestFriendRel, userRoomRel])
  .incoming([authorRel, recipientRel, bestFriendRel]);
type UserView = InferView<typeof userView>;

const chatRoomView = view(chatRoomModel)
  .outgoing([])
  .incoming([messageRoomRel, userRoomRel]);
type ChatRoomView = InferView<typeof chatRoomView>;

// test('valtio pool', () => {
//   const chatRoomPool = new ValtioPool(
//     poolSchema(chatRoomModel, [userModel, messageModel]),
//   );
//
//   const root = chatRoomPool.createRoot(roomEntity);
//
//   const edUser = chatRoomPool.createEntity({
//     name: 'User',
//     entity: edUserEntity,
//   });
//   const aliceUser = chatRoomPool.createEntity({
//     name: 'User',
//     entity: aliceUserEntity,
//   });
//   const message = chatRoomPool.createEntity({
//     name: 'Message',
//     entity: messageEntity,
//   });
//
//   console.log(edUser);
//   edUser.name = 'cool name';
// });

// test.skip('valtio graph', (t) => {
//   const chatRoomGraph = new ValtioGraph(
//     graphSchema(chatRoomView, [userView, messageView]),
//   );
//   const root = chatRoomGraph.createRoot(roomEntity);
//   const edUserObservable = chatRoomGraph.create('User', edUserEntity);
//   const aliceUserObservable = chatRoomGraph.create('User', aliceUserEntity);
//   const messageObservable = chatRoomGraph.create('Message', messageEntity);
//
//   console.log(root)
// });

export const roomEntity = {
  id: 'TestRoom',
  description: 'yooo',
  ownerId: '1',
  // userIds: [],
};

test.skip('valtio graph', async (t) => {
  const chatRoomGraph = new ValtioGraph(
    graphSchema(chatRoomView, [userView, messageView]),
  );
  const root = chatRoomGraph.createRoot(roomEntity, []);
  // const fred = chatRoomGraph.create('User', {
  //   id: '4',
  //   name: 'fred',
  //   roomId: 'TestRoom',
  //   bestFriendId: undefined,
  // });
  const ed = chatRoomGraph.create('User', {
    id: '1',
    name: 'ed',
    roomId: 'TestRoom',
    bestFriendId: undefined,
  });
  // const alice = chatRoomGraph.create('User', aliceUserEntity);
  const message = chatRoomGraph.create('Message', {
    id: '3',
    text: 'hello',
    authorId: '1',
    recipientId: '2',
    order: 0,
    roomId: 'TestRoom',
  });
  //root.userIds = proxy(new Array<UserView>());
  // root.userIds.push(fred.id);
  // root.userIds.push(alice.id);
  // root.userIds.push(ed.id);
  //ed.bestFriend = alice;
  //message.author = alice;

  // alice.name = 'hmm2';
  // what.name = 'hmm3';
  //root.name = 'hmm1';
  //root.bestFriend = alice;

  //what.bestFriendId = alice.id;
  // console.log(
  //   chatRoomGraph.getPool().getState().getEntityTables().get('User')!.entries(),
  // );

  await sleep(1000);
  console.log('slept');
  console.log(root);
  console.log(ed);
  chatRoomGraph.delete('Message', message.id);
  await sleep(1000);
  console.log('slept');
  console.log(root);
  //@ts-ignore
  //console.log(root.users[0]!.room.id);
  //@ts-ignore
  //console.log(root.users[1]!.room.id);
  // console.log(ed.room);
  // console.log(alice.room);
  // console.log(fred.room);
  //
  // console.log('neat');
  // //alice.name = 'alice 2';
  // root.description = 'asdasd';
  // await sleep(1000);
  // console.log('bruh');
  //console.log(message);
  //console.log(alice);
  // console.log(root.bestFriendOf);
});

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
