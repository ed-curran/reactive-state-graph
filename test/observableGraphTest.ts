import test from 'ava';
import { graphSchema, InferView, manyToOne, view, poolSchema } from '../src';
import {
  ObservableGraph,
  ObservablePool,
  source,
  target,
} from '../src/legendState';
import { batch } from '@legendapp/state';
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

const chatRoomView = view(chatRoomModel).incoming([
  messageRoomRel,
  userRoomRel,
]);
type ChatRoomView = InferView<typeof chatRoomView>;

test.skip('reactive pool', (t) => {
  const chatRoomPool = new ObservablePool(
    poolSchema(chatRoomModel, [userModel, messageModel]),
  );

  const root = chatRoomPool.createRoot(roomEntity);

  const edUserObservable = chatRoomPool.createEntity({
    name: 'User',
    entity: edUserEntity,
  });
  const aliceUserObservable = chatRoomPool.createEntity({
    name: 'User',
    entity: aliceUserEntity,
  });
  const messageObservable = chatRoomPool.createEntity({
    name: 'Message',
    entity: messageEntity,
  });

  batch(() => {
    root.ownerId.set('test');
    edUserObservable.name.set('ed is super cool');
    aliceUserObservable.name.set('alice is even cooler');
    messageObservable.text.set('very cool message');
  });
});

test.skip('observable graph', (t) => {
  const chatRoomGraph = new ObservableGraph(
    graphSchema(chatRoomView, [userView, messageView]),
  );
  const root = chatRoomGraph.createRoot(roomEntity);
  const edUserObservable = chatRoomGraph.create('User', edUserEntity);
  const aliceUserObservable = chatRoomGraph.create('User', aliceUserEntity);
  const messageObservable = chatRoomGraph.create('Message', messageEntity);

  console.log(
    root.users[0]
      ?.portal(userView)
      .inbox[0]?.portal(messageView)
      .recipient.portal(userView)
      .outbox.get(),
  );

  console.log(edUserObservable.get());
  console.log(aliceUserObservable.get());
  root.users[0]?.portal(userView).onChange(() => {
    console.log('first user changed');
  });

  messageObservable.author.portal().onChange((change) => {
    console.log('parent changed');
    console.log(change);
  });

  messageObservable.author.replaceWith(aliceUserObservable);

  console.log(edUserObservable.get());
  console.log(aliceUserObservable.get());
  //root.users[0]?.portal(userView).outbox[0].portal(messageView).author.

  //console.log(chatRoomGraph.pool.state.snapshot());
});
