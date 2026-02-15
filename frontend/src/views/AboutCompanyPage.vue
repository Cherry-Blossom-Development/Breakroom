<script setup>
</script>

<template>
  <div class="page-container about-page">
    <h1>What is Prosaurus?</h1>

    <div class="story">
      <p>
        Well, the story goes back about 10 years. Back then I had an idea for a better
        project management tool, because that's what I had to work with all day. The
        current tools were all bad for various reasons.
      </p>

      <p>
        But as the years went by and I tried to build it several times, I always ran into
        a problem. Usually that problem was that I was too busy with my day job to care
        much about making this dream project management software happen.
      </p>

      <p>
        Then, about a year ago, my mind started to wander. I started asking myself,
        <em>what is the most difficult part of managing projects?</em>
      </p>

      <p>
        Certainly it's the people, right? It's all that communication which has to be
        carefully controlled between the owners of the company, the developers, the
        managers, the clients, and everyone else involved.
      </p>

      <p>
        I thought, so, if I have to make a really good communications platform, why limit
        myself to project management? There's all kinds of things where good communication
        would come in handy, right?
      </p>

      <h2>The Pivot</h2>

      <p>
        So that's how I came up with the idea of <strong>Breakroom</strong>. Where project
        management is simply about getting work done, Breakroom is something more. It's a
        social thing also, and so I pivoted into making a social media platform instead.
      </p>

      <p>
        Then I started to think. Well, what's wrong with the current social media platforms?
      </p>

      <p>
        Certainly the main problem was all the advertising. Second was all the AI stuff
        (but that is more recent). What if I made a platform that doesn't have any of
        that garbage?
      </p>

      <h2>The Solution</h2>

      <p>
        The only problem is, how will I pay for it?
      </p>

      <p class="solution">
        The solution is simple. <strong>You pay for it.</strong>
      </p>
    </div>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 800px;
}

.about-page h1 {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--color-accent);
  margin-bottom: 2rem;
}

.about-page h2 {
  color: var(--color-text);
  font-size: 1.5rem;
  margin-top: 2.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--color-accent);
}

.story {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: var(--shadow-sm);
}

.story p {
  color: var(--color-text-secondary);
  font-size: 1.1rem;
  line-height: 1.8;
  margin-bottom: 1.25rem;
}

.story em {
  color: var(--color-accent);
  font-style: italic;
}

.story strong {
  color: var(--color-accent);
}

.solution {
  font-size: 1.3rem !important;
  text-align: center;
  padding: 1.5rem;
  background: var(--color-background-soft);
  border-radius: 8px;
  margin-top: 1.5rem;
}
</style>
