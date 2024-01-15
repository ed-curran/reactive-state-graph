import {
  batch,
  computed,
  observable,
  Observable,
  ObservableArray,
  ObservableComputed,
  ObservableObject,
  ObservablePrimitive,
} from '@legendapp/state';
import test from 'ava';

test.skip('portal test', () => {
  type Message = {
    id: string;
    text: string;
    user: Ref<User>;
  };
  type User = {
    id: string;
    roomId: string;
    messageIds: string[];
    profileId: string;
    name: string;
    room: Ref<Room>;
    messages: Ref<Message>[];
  };

  const edUser: Observable<User> = observable<User>({
    id: 'userEd',
    roomId: 'mainRoom',
    messageIds: ['1'],
    profileId: 'ed',
    name: 'my name',
    room: initRef(() => ({ refId: edUser.roomId, pool: roomPool })),
    messages: [],
  });

  type Room = {
    id: string;
    description: string;
    users: Ref<User>[];
  };

  const room: Observable<Room> = observable<Room>({
    id: 'mainRoom',
    description: 'main room',
    users: [],
  });

  const sideRoom: Observable<Room> = observable<Room>({
    id: 'sideRoom',
    description: 'side room is best room',
    users: [],
  });

  const roomPool: { [key: string]: ObservableObject<Room> } = {
    ['mainRoom']: room,
    ['sideRoom']: sideRoom,
  };

  const messageOne: ObservableObject<Message> = observable<Message>({
    id: '1',
    text: 'asdasd',
    user: initRef(() => ({ refId: messageOne.user.id, pool: userPool })),
  });
  const messageTwo: ObservableObject<Message> = observable<Message>({
    id: '2',
    text: 'twooooo',
    user: initRef(() => ({ refId: messageOne.user.id, pool: userPool })),
  });
  const messagePool: { [key: string]: ObservableObject<Message> } = {
    ['1']: messageOne,
    ['2']: messageTwo,
  };

  let userPool: { [key: string]: ObservableObject<User> } = {
    ['userEd']: edUser,
  };

  materialiseSingleToCollection(
    { id: edUser.id, field: edUser.roomId, materialisedAs: edUser.room },
    userPool,
    { materialisedAs: 'users' },
    roomPool,
  );

  materialiseCollectionToSingle(
    {
      id: edUser.id,
      field: edUser.messageIds,
      materialisedAs: edUser.messages,
    },
    userPool,
    { materialisedAs: 'users' },
    messagePool,
  );

  const aliceUser: Observable<User> = observable<User>({
    id: 'userAlice',
    roomId: 'mainRoom',
    messageIds: [],
    profileId: 'alice',
    name: 'my name',
    room: initRef(() => ({ refId: aliceUser.roomId, pool: roomPool })),
    messages: [],
  });
  userPool['userAlice'] = aliceUser;

  materialiseSingleToCollection(
    {
      id: aliceUser.id,
      field: aliceUser.roomId,
      materialisedAs: aliceUser.room,
    },
    userPool,
    { materialisedAs: 'users' },
    roomPool,
  );

  materialiseCollectionToSingle(
    {
      id: aliceUser.id,
      field: aliceUser.messageIds,
      materialisedAs: aliceUser.messages,
    },
    userPool,
    { materialisedAs: 'users' },
    messagePool,
  );

  room.onChange((change) => {
    console.log('main room saw itself change');
    console.log(change);
  });
  sideRoom.onChange((change) => {
    console.log('side room saw itself change');
    console.log(change);
  });
  console.log(room.users[0]?.get() as any);

  console.log(room);

  room.description.set('room changes room first');
});

function cached<T>(cached: T) {
  return () => cached;
}

function cachedPortal<T>(
  refId: Observable<string>,
  pool: { [key: string]: Observable<T> },
) {
  let portal: Observable<T>;
  return () => {
    if (portal) return portal;
    portal = computed<Observable<T>>(() => pool[refId.get()]!);
    return portal;
  };
}

function cachedComputed<T>(
  refId: Observable<string>,
  pool: { [key: string]: Observable<T> },
) {
  let portal: ObservableComputed<T>;
  return () => {
    if (portal) return portal;
    portal = computed(() => pool[refId.get()]?.get()!);
    return portal;
  };
}

interface Ref<T> {
  id: string;
  //portals through to another entity in the graph, the returned observable:
  //1. does get notified when the entry entity is modified but only when listening to the observable returned, not on nested fields (no idea why)
  //2. does get notified when this entity is modified by others (i.e. those that have portaled to it)
  //3. does notify others listening to this entity
  //4. does not notify the entry entity when modified
  portal(): ObservableObject<T>;

  //appends a readonly branch containing the referenced entity to the current "tree", the returned observable:
  //1. does get notified when the parent is modified when listening anywhere in the branch
  //2. does not get notified when others modify this entity elsewhere in the graph
  //3. can not be modified
  // branch: ObservableComputed<T>;

  //replace this reference with another, only available on the source of the reference
  // replace(replacement?: T): void;
}

interface LazyRef<T> {
  refId: ObservablePrimitive<string>;
  pool: { [keys: string]: ObservableObject<T> };
}

// function lazySyncEntity<T>(ref: () => LazyRef<T>): () => ObservableObject<T> {
//   return () => ref.pool[ref.refId.get()]!;
// }
function initRef<T>(lazyRef: () => LazyRef<T>, initialId?: string): Ref<T> {
  const lazySync = () => {
    //how can i avoid the computed from calling this function without having to evaluate whats in the ref yet
    const ref = lazyRef();
    console.log('sync');
    console.log(ref.refId);
    return ref.pool[ref.refId.get()]!;
  };
  return {
    id: initialId ?? '',
    portal: cached(computed<ObservableObject<T>>(lazySync)),
  };
}

function materialiseSingleToCollection<
  S extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
  T extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
>(
  source: {
    id: ObservablePrimitive<string>;
    field: ObservablePrimitive<string>;
    materialisedAs: ObservableObject<Ref<{}>>; //have a hard time typing this
  },
  sourcePool: { [keys: string]: S },
  target: {
    materialisedAs: string;
  },
  targetPool: { [keys: string]: T },
) {
  source.field.onChange(
    (change) => {
      const sourceId = source.id.peek();
      //console.log('ed room changed');
      //prev will be undefined the first time this is run but its not typed correctly...
      const prev: string | undefined = change.getPrevious();

      batch(() => {
        if (prev !== undefined && prev !== change.value) {
          const prevTargetEntity = targetPool[prev];
          if (prevTargetEntity) {
            const prevTargetCollection = prevTargetEntity[
              target.materialisedAs
            ] as ObservableArray<Ref<any>[]>;
            prevTargetCollection.set(
              prevTargetCollection.peek().filter((ref) => ref.id !== sourceId),
            );
          }
        }

        const targetEntity = targetPool[change.value];
        if (!targetEntity) return;

        //materialise target to self
        source.materialisedAs.id.set(change.value);

        //materialise self to target

        //would think you could type this better by typing S and T as objects then wrapping in ObservableObject
        // where necessary but ObservableObject is weird and that breaks things even harder
        const targetCollection = targetEntity[
          target.materialisedAs
        ] as ObservableArray<Ref<{}>[]>;

        console.log({
          wat: targetCollection.peek(),
          length: targetCollection.peek().length,
        });
        const refId = targetCollection[targetCollection.peek().length]!.id;
        const ref = initRef(
          () => ({
            refId: refId,
            pool: sourcePool,
          }),
          sourceId,
        );
        targetCollection.push(ref);
      });
    },
    { initial: true },
  );
}

function materialiseSingleToSingle<
  S extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
  T extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
>(
  source: {
    id: ObservablePrimitive<string>;
    field: ObservablePrimitive<string>;
    materialisedAs: ObservableObject<Ref<any>>;
  },
  sourcePool: { [keys: string]: S },
  target: {
    materialisedAs: string;
  },
  targetPool: { [keys: string]: T },
) {
  source.field.onChange(
    (change) => {
      const sourceId = source.id.peek();
      //console.log('ed room changed');
      //prev will be undefined the first time this is run but its not typed correctly...
      const prev: string | undefined = change.getPrevious();

      batch(() => {
        if (prev !== undefined && prev !== change.value) {
          const prevTargetEntity = targetPool[prev];
          if (prevTargetEntity) {
            const prevTargetSingle = prevTargetEntity[
              target.materialisedAs
            ] as ObservableObject<Ref<any>>;
            //todo: probably don't set this to undefined an try to reuse the ref instead
            prevTargetSingle.set(undefined);
          }
        }

        const targetEntity = targetPool[change.value];
        if (!targetEntity) return;

        //materialise target to self
        source.materialisedAs.id.set(change.value);

        //materialise self to target

        //would think you could type this better by typing S and T as objects then wrapping in ObservableObject
        // where necessary but ObservableObject is weird and that breaks things even harder
        const targetSingle = targetEntity[
          target.materialisedAs
        ] as ObservableObject<Ref<any>>;
        targetSingle.id.set(sourceId);
      });
    },
    { initial: true },
  );
}

function materialiseCollectionToSingle<
  S extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
  T extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
>(
  source: {
    id: ObservablePrimitive<string>;
    field: ObservableArray<string[]>;
    materialisedAs: ObservableArray<Ref<{}>[]>;
  },
  sourcePool: { [keys: string]: S },
  target: {
    materialisedAs: string;
  },
  targetPool: { [keys: string]: T },
) {
  source.field.onChange(
    (params) => {
      let index = 0;
      for (const messageId of params.value) {
        //materialise on source
        const messageRef = source.materialisedAs[index];
        if (messageRef?.peek()) {
          messageRef.id.set(messageId);
        } else {
          const ref = initRef(
            () => ({
              refId: source.materialisedAs[index]!.id,
              pool: targetPool,
            }),
            messageId,
          );
          source.materialisedAs.push(ref);
        }
        //materialise on target
        const targetEntity = targetPool[messageId];
        if (targetEntity) {
          const targetRef = targetEntity[
            target.materialisedAs
          ] as ObservableObject<Ref<S>>;
          //idk man the typing gets messed up
          const targetRefId = targetRef.id as ObservablePrimitive<string>;
          if (targetRef.peek()) {
            targetRefId.set(source.id.peek());
          } else {
            //Observable type gets fucked up by generics
            targetRef.set(
              initRef(() => ({ refId: targetRefId, pool: sourcePool })) as any,
            );
          }
        }

        index++;
      }

      //resize the array to match the messageIds
      //doing this with pop because it seems safer
      //the observable array might handle updating affected people
      for (let i = index; i < source.materialisedAs.length; i++) {
        // const messageRef = edUser.messages[i]!;
        // messageRef.id.set(undefined);
        source.materialisedAs.pop();
      }
    },
    { initial: true },
  );
}
