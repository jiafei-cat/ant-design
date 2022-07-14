import classNames from 'classnames';
import ResizeObserver from 'rc-resize-observer';
import omit from 'rc-util/lib/omit';
import * as React from 'react';
import type { ConfigConsumerProps } from '../config-provider';
import { ConfigContext } from '../config-provider';
import { throttleByAnimationFrameDecorator } from '../_util/throttleByAnimationFrame';

import {
  addObserveTarget,
  getFixedBottom,
  getFixedTop,
  getTargetRect,
  removeObserveTarget,
} from './utils';

function getDefaultTarget() {
  return typeof window !== 'undefined' ? window : null;
}

// Affix
export interface AffixProps {
  /** 距离窗口顶部达到指定偏移量后触发 */
  offsetTop?: number;
  /** 距离窗口底部达到指定偏移量后触发 */
  offsetBottom?: number;
  style?: React.CSSProperties;
  /** 固定状态改变时触发的回调函数 */
  onChange?: (affixed?: boolean) => void;
  /** 设置 Affix 需要监听其滚动事件的元素，值为一个返回对应 DOM 元素的函数 */
  target?: () => Window | HTMLElement | null;
  prefixCls?: string;
  className?: string;
  children: React.ReactNode;
}

interface InternalAffixProps extends AffixProps {
  affixPrefixCls: string;
}

enum AffixStatus {
  None,
  Prepare,
}

export interface AffixState {
  affixStyle?: React.CSSProperties;
  placeholderStyle?: React.CSSProperties;
  status: AffixStatus;
  lastAffix: boolean;

  prevTarget: Window | HTMLElement | null;
}

/**
 * 流程 -> 
 */
class Affix extends React.Component<InternalAffixProps, AffixState> {
  static contextType = ConfigContext;

  state: AffixState = {
    status: AffixStatus.None,
    lastAffix: false,
    prevTarget: null,
  };

  placeholderNode: HTMLDivElement;

  fixedNode: HTMLDivElement;

  private timeout: any;

  context: ConfigConsumerProps;

  /** 获取监听元素，没有的话会取window */
  private getTargetFunc() {
    const { getTargetContainer } = this.context;
    const { target } = this.props;

    if (target !== undefined) {
      return target;
    }

    return getTargetContainer || getDefaultTarget;
  }

  // Event handler
  componentDidMount() {
    const targetFunc = this.getTargetFunc();
    if (targetFunc) {
      // [Legacy] Wait for parent component ref has its value.
      // We should use target as directly element instead of function which makes element check hard.
      // 这里为了等待异步的dom，使用定时器做异步获取container
      this.timeout = setTimeout(() => {
        /** 添加当前组件的触发和监听target - 会触发lazyUpdatePosition */
        addObserveTarget(targetFunc(), this);
        // Mock Event object. 
        // 更新初始状态去触发componentDidUpdate
        this.updatePosition();
      });
    }
  }

  componentDidUpdate(prevProps: AffixProps) {
    const { prevTarget } = this.state;
    const targetFunc = this.getTargetFunc();
    const newTarget = targetFunc?.() || null;

    /** 第一次肯定是不同的，后续有可能target变化，所以这里得重新监听 */
    if (prevTarget !== newTarget) {
      removeObserveTarget(this);
      if (newTarget) {
        addObserveTarget(newTarget, this);
        // Mock Event object.
        this.updatePosition();
      }

      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ prevTarget: newTarget });
    }
    /** offsetTop/offsetBottom props变化时重新更新位置 */
    if (
      prevProps.offsetTop !== this.props.offsetTop ||
      prevProps.offsetBottom !== this.props.offsetBottom
    ) {
      this.updatePosition();
    }
    /** 每次自身state/props改变都会调用measure */
    this.measure();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout);
    removeObserveTarget(this);
    (this.updatePosition as any).cancel();
    // https://github.com/ant-design/ant-design/issues/22683
    (this.lazyUpdatePosition as any).cancel();
  }

  /** 处理参数offsetTop， 返回值可能是undefined*/
  getOffsetTop = () => {
    const { offsetBottom, offsetTop } = this.props;
    return offsetBottom === undefined && offsetTop === undefined ? 0 : offsetTop;
  };

  getOffsetBottom = () => this.props.offsetBottom;

  savePlaceholderNode = (node: HTMLDivElement) => {
    this.placeholderNode = node;
  };

  saveFixedNode = (node: HTMLDivElement) => {
    this.fixedNode = node;
  };

  // =================== Measure ===================
  measure = () => {
    const { status, lastAffix } = this.state;
    const { onChange } = this.props;
    const targetFunc = this.getTargetFunc();
    /** 确保当前 组件状态/target/固定元素/占位元素 都存在 */
    if (status !== AffixStatus.Prepare || !this.fixedNode || !this.placeholderNode || !targetFunc) {
      return;
    }

    const offsetTop = this.getOffsetTop();
    const offsetBottom = this.getOffsetBottom();

    const targetNode = targetFunc();
    if (!targetNode) {
      return;
    }

    const newState: Partial<AffixState> = {
      status: AffixStatus.None,
    };

    const targetRect = getTargetRect(targetNode);
    const placeholderReact = getTargetRect(this.placeholderNode);
    const fixedTop = getFixedTop(placeholderReact, targetRect, offsetTop);
    const fixedBottom = getFixedBottom(placeholderReact, targetRect, offsetBottom);

    if (fixedTop !== undefined) {
      newState.affixStyle = {
        position: 'fixed',
        top: fixedTop,
        width: placeholderReact.width,
        height: placeholderReact.height,
      };
      /** placeholderReact 其实是父级的视图信息 */
      newState.placeholderStyle = {
        width: placeholderReact.width,
        height: placeholderReact.height,
      };
    } else if (fixedBottom !== undefined) {
      newState.affixStyle = {
        position: 'fixed',
        bottom: fixedBottom,
        width: placeholderReact.width,
        height: placeholderReact.height,
      };
      /** placeholderReact 其实是父级的视图信息 */
      newState.placeholderStyle = {
        width: placeholderReact.width,
        height: placeholderReact.height,
      };
    }

    /** 通过lastAffix记录当前组件状态和上一次状态，以便触发props.onChange */
    newState.lastAffix = !!newState.affixStyle;
    if (onChange && lastAffix !== newState.lastAffix) {
      onChange(newState.lastAffix);
    }

    this.setState(newState as AffixState);
  };

  // @ts-ignore TS6133
  /** 计算位置的前置参数准备 */
  prepareMeasure = () => {
    // event param is used before. Keep compatible ts define here.
    this.setState({
      status: AffixStatus.Prepare,
      affixStyle: undefined,
      placeholderStyle: undefined,
    });

    // Test if `updatePosition` called
    if (process.env.NODE_ENV === 'test') {
      const { onTestUpdatePosition } = this.props as any;
      onTestUpdatePosition?.();
    }
  };

  // Handle realign logic
  @throttleByAnimationFrameDecorator()
  updatePosition() {
    this.prepareMeasure();
  }

  @throttleByAnimationFrameDecorator()
  lazyUpdatePosition() {
    const targetFunc = this.getTargetFunc();
    const { affixStyle } = this.state;
    // 在计算位置前，先计算一次，排除掉固定状态未发生改变的情况
    // Check position change before measure to make Safari smooth
    if (targetFunc && affixStyle) {
      const offsetTop = this.getOffsetTop();
      const offsetBottom = this.getOffsetBottom();

      const targetNode = targetFunc();
      if (targetNode && this.placeholderNode) {
        const targetRect = getTargetRect(targetNode);
        const placeholderReact = getTargetRect(this.placeholderNode);
        const fixedTop = getFixedTop(placeholderReact, targetRect, offsetTop);
        const fixedBottom = getFixedBottom(placeholderReact, targetRect, offsetBottom);

        if (
          (fixedTop !== undefined && affixStyle.top === fixedTop) ||
          (fixedBottom !== undefined && affixStyle.bottom === fixedBottom)
        ) {
          return;
        }
      }
    }

    // Directly call prepare measure since it's already throttled.
    this.prepareMeasure();
  }

  // =================== Render ===================
  render() {
    const { affixStyle, placeholderStyle } = this.state;
    const { affixPrefixCls, children } = this.props;
    const className = classNames({
      [affixPrefixCls]: !!affixStyle,
    });

    let props = omit(this.props, [
      'prefixCls',
      'offsetTop',
      'offsetBottom',
      'target',
      'onChange',
      'affixPrefixCls',
    ]);
    // Omit this since `onTestUpdatePosition` only works on test.
    if (process.env.NODE_ENV === 'test') {
      props = omit(props as typeof props & { onTestUpdatePosition: any }, ['onTestUpdatePosition']);
    }

    return (
      <ResizeObserver
        onResize={() => {
          this.updatePosition();
        }}
      >
        <div {...props} ref={this.savePlaceholderNode}>
          {affixStyle && <div style={placeholderStyle} aria-hidden="true" />}
          <div className={className} ref={this.saveFixedNode} style={affixStyle}>
            <ResizeObserver
              onResize={() => {
                this.updatePosition();
              }}
            >
              {children}
            </ResizeObserver>
          </div>
        </div>
      </ResizeObserver>
    );
  }
}
// just use in test
export type InternalAffixClass = Affix;

const AffixFC = React.forwardRef<Affix, AffixProps>((props, ref) => {
  const { prefixCls: customizePrefixCls } = props;
  const { getPrefixCls } = React.useContext(ConfigContext);

  const affixPrefixCls = getPrefixCls('affix', customizePrefixCls);

  const affixProps: InternalAffixProps = {
    ...props,

    affixPrefixCls,
  };

  return <Affix {...affixProps} ref={ref} />;
});

if (process.env.NODE_ENV !== 'production') {
  AffixFC.displayName = 'Affix';
}

export default AffixFC;
