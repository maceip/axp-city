import Phaser from "phaser";

/**
 * Reuses game objects instead of destroying and recreating them as lots and
 * actors cross the viewport edge. Released objects are hidden and parked; the
 * pool is bounded so memory stays flat during sustained travel.
 */
export class ObjectPool<T extends Phaser.GameObjects.GameObject> {
  private free: T[] = [];
  live = 0;
  constructor(
    private readonly make: () => T,
    private readonly reset: (object: T) => void,
    private readonly capacity = 600,
  ) {}
  acquire(): T {
    this.live++;
    const object = this.free.pop();
    if (object) {
      object.setActive(true);
      (object as unknown as { setVisible(v: boolean): void }).setVisible(true);
      return object;
    }
    return this.make();
  }
  release(object: T): void {
    this.live--;
    this.reset(object);
    object.setActive(false);
    (object as unknown as { setVisible(v: boolean): void }).setVisible(false);
    if (this.free.length < this.capacity) this.free.push(object);
    else object.destroy();
  }
  get parked(): number {
    return this.free.length;
  }
  destroy(): void {
    for (const object of this.free) object.destroy();
    this.free = [];
  }
}

export function imagePool(scene: Phaser.Scene, capacity?: number) {
  return new ObjectPool<Phaser.GameObjects.Image>(
    () => scene.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 1),
    (image) => {
      image.setAlpha(1).setScale(1).setFlipX(false).setTint(0xffffff).clearTint();
      image.setDepth(0);
    },
    capacity,
  );
}

export function spritePool(scene: Phaser.Scene, capacity?: number) {
  return new ObjectPool<Phaser.GameObjects.Sprite>(
    () => scene.add.sprite(0, 0, "__DEFAULT").setOrigin(0.5, 1),
    (sprite) => {
      sprite.anims.stop();
      sprite.setAlpha(1).setScale(1).setFlipX(false).clearTint();
      sprite.setDepth(0);
    },
    capacity,
  );
}

export function graphicsPool(scene: Phaser.Scene, capacity?: number) {
  return new ObjectPool<Phaser.GameObjects.Graphics>(
    () => scene.add.graphics(),
    (g) => {
      g.clear();
      g.setDepth(0).setAlpha(1);
    },
    capacity,
  );
}
