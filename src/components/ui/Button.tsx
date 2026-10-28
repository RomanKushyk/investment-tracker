import type { ComponentProps } from 'react';
import type { VariantProps } from 'class-variance-authority';

import { buttonVariants } from './button-variants';

interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, weight, size, disabledTone, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonVariants({ variant, weight, size, disabledTone, className })}
      {...props}
    />
  );
}
