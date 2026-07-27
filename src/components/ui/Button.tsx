import type { ButtonHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';

import { buttonVariants } from './button-variants';

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, weight, ...props }: ButtonProps) {
  return (
    <button type="button" className={buttonVariants({ variant, weight, className })} {...props} />
  );
}
