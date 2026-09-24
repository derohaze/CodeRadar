"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TextMorphProps {
  children: string;
  className?: string;
  as?: "span" | "div" | "p";
}

export function TextMorph({ children, className, as: Component = "span" }: TextMorphProps) {
  return (
    <span className={cn("relative inline-flex overflow-hidden leading-none", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(children)}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(4px)" }}
          transition={{
            duration: 0.35,
            ease: [0.4, 0, 0.2, 1],
          }}
          layout
          className="inline-block whitespace-nowrap will-change-transform"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
