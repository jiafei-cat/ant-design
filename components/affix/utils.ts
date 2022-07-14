/** 这个addEventListener是对原有addEventListener增加了ReactDOM.batchedUpdates去批量调用callback */
import addEventListener from 'rc-util/lib/Dom/addEventListener';

export type BindElement = HTMLElement | Window | null | undefined;
/** 
 * 利用getBoundingClientRect获取元素在当前视图位置
 * (window无此方法所以单独处理window的情况) 
 * */
export function getTargetRect(target: BindElement): DOMRect {
  return target !== window
    ? (target as HTMLElement).getBoundingClientRect()
    : ({ top: 0, bottom: window.innerHeight } as DOMRect);
}
/** 对比占位元素和container的top, 如果重合返回container距离视口的top值(会计算props的offsetTop) */
export function getFixedTop(placeholderReact: DOMRect, targetRect: DOMRect, offsetTop?: number) {
  if (offsetTop !== undefined && targetRect.top > placeholderReact.top - offsetTop) {
    return offsetTop + targetRect.top;
  }
  return undefined;
}
/** 对比占位元素和container的bottom, 如果重合返回container距离视口的bottom值(会计算props的offsetBottom) */
export function getFixedBottom(
  placeholderReact: DOMRect,
  targetRect: DOMRect,
  offsetBottom?: number,
) {
  if (offsetBottom !== undefined && targetRect.bottom < placeholderReact.bottom + offsetBottom) {
    const targetBottomOffset = window.innerHeight - targetRect.bottom;
    return offsetBottom + targetBottomOffset;
  }
  return undefined;
}

// ======================== Observer ========================

const TRIGGER_EVENTS = [
  'resize',
  'scroll',
  'touchstart',
  'touchmove',
  'touchend',
  'pageshow',
  'load',
];

interface ObserverEntity {
  /** 监听元素 */
  target: HTMLElement | Window;
  /** 监听触发组件list - 用于存储需要触发的affix组件 */
  affixList: any[];
  /** 存储removeEventlistener */
  eventHandlers: { [eventName: string]: any };
}

let observerEntities: ObserverEntity[] = [];

export function getObserverEntities() {
  // Only used in test env. Can be removed if refactor.
  return observerEntities;
}

/**
 * 对taget增加监听
 */
export function addObserveTarget<T>(target: HTMLElement | Window | null, affix: T): void {
  if (!target) return;

  let entity: ObserverEntity | undefined = observerEntities.find(item => item.target === target);
  
  /**
   * 判断是否已经存在taget的监听对象
   * 如果有就将当前affix添加到触发列表中(affixList)
   * 如果没有创建新的监听对象，并绑定监听
   */
  if (entity) {
    entity.affixList.push(affix);
  } else {
    entity = {
      target,
      affixList: [affix],
      eventHandlers: {},
    };
    observerEntities.push(entity);

    /** 添加监听 */
    TRIGGER_EVENTS.forEach(eventName => {
      entity!.eventHandlers[eventName] = addEventListener(target, eventName, () => {
        entity!.affixList.forEach(targetAffix => {
          targetAffix.lazyUpdatePosition();
        });
      });
    });
  }
}

export function removeObserveTarget<T>(affix: T): void {
  /** 删除指定触发的affix */
  const observerEntity = observerEntities.find(oriObserverEntity => {
    const hasAffix = oriObserverEntity.affixList.some(item => item === affix);
    if (hasAffix) {
      oriObserverEntity.affixList = oriObserverEntity.affixList.filter(item => item !== affix);
    }
    return hasAffix;
  });

  /** 没有触发的监听取消掉所有事件监听 */
  if (observerEntity && observerEntity.affixList.length === 0) {
    observerEntities = observerEntities.filter(item => item !== observerEntity);

    // Remove listener
    TRIGGER_EVENTS.forEach(eventName => {
      const handler = observerEntity.eventHandlers[eventName];
      if (handler && handler.remove) {
        handler.remove();
      }
    });
  }
}
