import * as React from 'react';
import { s } from './style.js';

// Replaces the design's `style-hover="..."` / `style-focus="..."` /
// `style-active="..."` attributes, which the design runtime applies on top
// of the base `style="..."` while the element is in that interaction
// state. `as` picks the underlying element ('div' by default) so this one
// component covers button/input/select/div/span/a in the ported markup.
// Every other prop (onClick, type, disabled, aria-*, value, onChange, ...)
// is forwarded to the underlying element untouched.
type HovOwnProps = {
  as?: React.ElementType;
  style?: string;
  hover?: string;
  focus?: string;
  active?: string;
  children?: React.ReactNode;
};

export function Hov(props: HovOwnProps & Record<string, any>) {
  const { as, style, hover, focus, active, children, ...rest } = props;
  const Tag = (as ?? 'div') as React.ElementType;

  const [isHovered, setHovered] = React.useState(false);
  const [isFocused, setFocused] = React.useState(false);
  const [isActive, setActive] = React.useState(false);

  const base = style ? s(style) : undefined;
  // Parsed unconditionally (not gated on isHovered/isFocused/isActive) so the
  // key set below is stable across renders regardless of interaction state.
  const hoverParsed = hover ? s(hover) : undefined;
  const focusParsed = focus ? s(focus) : undefined;
  const activeParsed = active ? s(active) : undefined;

  const hoverStyle = isHovered ? hoverParsed : undefined;
  const focusStyle = isFocused ? focusParsed : undefined;
  const activeStyle = isActive ? activeParsed : undefined;

  // The design pairs a shorthand base style (e.g. `border:1px solid ...`)
  // with a longhand style-hover/-focus/-active override (e.g.
  // `border-color:...`) throughout the ported markup. Naively spreading
  // `{...base, ...hoverStyle, ...focusStyle, ...activeStyle}` makes that
  // longhand key appear and disappear across renders as interaction state
  // toggles, which triggers React's "Removing a style property during
  // rerender when a conflicting property is set" DOM warning. Pre-seeding
  // every key that appears in ANY variant (base/hover/focus/active) keeps
  // the property present (as '', i.e. unset) on every render — only its
  // value changes — so the warning never fires, with no visual difference.
  let mergedStyle: React.CSSProperties | undefined;
  if (base || hoverParsed || focusParsed || activeParsed) {
    mergedStyle = {};
    for (const key of new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(hoverParsed ?? {}),
      ...Object.keys(focusParsed ?? {}),
      ...Object.keys(activeParsed ?? {}),
    ])) {
      (mergedStyle as Record<string, string>)[key] = '';
    }
    Object.assign(mergedStyle, base, hoverStyle, focusStyle, activeStyle);
  }

  return (
    <Tag
      {...rest}
      style={mergedStyle}
      onMouseEnter={(e: React.MouseEvent) => {
        setHovered(true);
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e: React.MouseEvent) => {
        setHovered(false);
        if (active) setActive(false);
        rest.onMouseLeave?.(e);
      }}
      onMouseDown={(e: React.MouseEvent) => {
        if (active) setActive(true);
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e: React.MouseEvent) => {
        if (active) setActive(false);
        rest.onMouseUp?.(e);
      }}
      onFocus={(e: React.FocusEvent) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e: React.FocusEvent) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
    >
      {children}
    </Tag>
  );
}
